// Production planner: suggests a machine for every roll waiting to be printed or cut, and forecasts when
// each order will be ready. Rules come from the client's spec: printing depends on the cylinder size and the
// delivery date; cutting depends on which cutting machines can make that bag type.
//
// Method (greedy, earliest-due-first):
//   1. Sort waiting rolls by the order's delivery date.
//   2. Give each roll to the capable machine that can take it soonest, given its rolls-per-day capacity
//      and what it already finished today.
//   3. A roll can be cut the working day after it is printed.
// Sundays are treated as non-working days.
import { all, one, today } from "./db.js";
import { BAG_TYPES, cylinderSize, bagsFromRoll } from "./formulas.js";

const DEFAULT_PER_DAY = { printing: 4, cutting: 3 };

/** How many colours a print job needs, read from the order's printing description. */
export function coloursNeeded(text) {
  if (!text || /plain/i.test(text)) return 0;
  const m = String(text).match(/(\d+)\s*colou?r/i);
  return m ? Number(m[1]) : 1;
}

/** Working day n (0 = today) as an ISO date, skipping Sundays. */
export function workDate(n) {
  const d = new Date(today() + "T00:00:00");
  let left = n;
  while (d.getDay() === 0) d.setDate(d.getDate() + 1);
  while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0) left--; }
  return d.toLocaleDateString("en-CA");
}

const list = (s) => (s ? String(s).split(",").map((x) => x.trim()).filter(Boolean) : []);

export function canPrint(m, job) {
  const need = coloursNeeded(job.print_colors);
  if (m.colours != null && need > m.colours) return `prints ${m.colours} colour${m.colours === 1 ? "" : "s"}, job needs ${need}`;
  const cyl = list(m.cylinders).map(Number);
  if (cyl.length && !cyl.includes(job.cylinder)) return `no ${job.cylinder}″ cylinder`;
  return null;
}
export function canCut(m, job) {
  const types = list(m.bag_types);
  if (types.length && !types.includes(job.bag_type)) return `doesn't cut ${BAG_TYPES[job.bag_type].name}`;
  return null;
}

/** Slot book for one machine: how many rolls are already booked on each working day. */
function slots(machine, doneToday) {
  const cap = machine.per_day || DEFAULT_PER_DAY[machine.kind];
  const used = [doneToday];
  return {
    machine,
    /** first working day >= from with free capacity */
    peek(from) { let d = from; while ((used[d] || 0) >= cap) d++; return d; },
    take(day) { used[day] = (used[day] || 0) + 1; },
  };
}

export function buildPlan() {
  const t = today();
  const machines = all("SELECT * FROM machines WHERE active = 1 ORDER BY id");
  const doneToday = (m) => one(`SELECT COUNT(*) n FROM rolls WHERE ${m.kind === "printing" ? "print_machine_id" : "cut_machine_id"} = ? AND ${m.kind === "printing" ? "printed_on" : "cut_on"} = ?`, m.id, t).n;
  const printers = machines.filter((m) => m.kind === "printing").map((m) => slots(m, doneToday(m)));
  const cutters = machines.filter((m) => m.kind === "cutting").map((m) => slots(m, doneToday(m)));

  const base = `SELECT r.*, o.order_no, o.bag_type, o.w, o.l, o.g, o.due_date, o.print_colors, o.qty, c.name client
                FROM rolls r JOIN orders o ON o.id = r.order_id JOIN clients c ON c.id = o.client_id WHERE o.status = 'open' AND `;
  const shape = (r) => ({ ...r, cylinder: cylinderSize(r.bag_type, r), est_bags: bagsFromRoll(r.bag_type, r, r) });
  const toPrint = all(base + "r.printed_on IS NULL AND r.status = 'stock' ORDER BY o.due_date, r.id").map(shape);
  const toCut = all(base + "r.printed_on IS NOT NULL AND r.cut_on IS NULL ORDER BY o.due_date, r.id").map(shape);

  const rolls = {}; // roll id -> suggestion
  const pick = (pool, check, job, from) => {
    let best = null; const reasons = [];
    for (const s of pool) {
      const why = check(s.machine, job);
      if (why) { reasons.push(`${s.machine.name}: ${why}`); continue; }
      const day = s.peek(from);
      if (!best || day < best.day) best = { s, day };
    }
    if (!best) return { problem: pool.length ? `No machine can take it (${reasons.join("; ")})` : "No active machine of this type" };
    best.s.take(best.day);
    return { machine_id: best.s.machine.id, machine: best.s.machine.name, day: best.day, date: workDate(best.day) };
  };

  for (const r of toPrint) {
    const p = pick(printers, canPrint, r, 0);
    rolls[r.id] = { print: p };
  }
  const cutJobs = [
    ...toCut.map((r) => ({ r, ready: 0 })),
    ...toPrint.filter((r) => rolls[r.id].print.day != null).map((r) => ({ r, ready: rolls[r.id].print.day + 1 })),
  ].sort((a, b) => (a.r.due_date < b.r.due_date ? -1 : a.r.due_date > b.r.due_date ? 1 : a.ready - b.ready));
  for (const { r, ready } of cutJobs) {
    (rolls[r.id] ||= {}).cut = pick(cutters, canCut, r, ready);
  }
  for (const r of toPrint) if (!rolls[r.id].cut) rolls[r.id].cut = { problem: "Can't be cut until it has a printing machine" };

  // Per-order forecast: ready when its last roll is cut.
  const orders = {};
  for (const r of [...toPrint, ...toCut]) {
    const s = rolls[r.id];
    const o = (orders[r.order_id] ||= { order_id: r.order_id, order_no: r.order_no, client: r.client, due_date: r.due_date, lastDay: 0, problem: null, rolls: 0 });
    o.rolls++;
    if (s.cut?.problem || s.print?.problem) o.problem = s.print?.problem || s.cut.problem;
    else o.lastDay = Math.max(o.lastDay, s.cut.day);
  }
  for (const o of Object.values(orders)) {
    o.ready_date = o.problem ? null : workDate(o.lastDay);
    o.at_risk = !o.problem && o.ready_date > o.due_date;
    o.days_over = o.at_risk ? Math.round((new Date(o.ready_date) - new Date(o.due_date)) / 864e5) : 0;
  }

  const load = (pool) => pool.map((s) => ({ id: s.machine.id, name: s.machine.name, per_day: s.machine.per_day || DEFAULT_PER_DAY[s.machine.kind] }));

  return {
    rolls, orders,
    summary: {
      printDays: Math.max(0, ...toPrint.map((r) => rolls[r.id].print.day ?? 0)) + (toPrint.length ? 1 : 0),
      cutDays: Math.max(0, ...cutJobs.map(({ r }) => rolls[r.id].cut.day ?? 0)) + (cutJobs.length ? 1 : 0),
      atRisk: Object.values(orders).filter((o) => o.at_risk).sort((a, b) => b.days_over - a.days_over),
      blocked: Object.values(orders).filter((o) => o.problem),
      machines: { printing: load(printers), cutting: load(cutters) },
    },
  };
}
