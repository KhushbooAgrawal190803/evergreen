import express from "express";
import { all, one, run, tx, log, today, addDays } from "./db.js";
import { BAG_TYPES, bagsFromRoll, rollSizeRange, fabricKgForOrder, orderPreview, cylinderSize, LOOP_WEIGHT_G } from "./formulas.js";

import { buildPlan, canPrint, canCut, coloursNeeded } from "./planner.js";
import { authPublic, authPrivate, requireAuth, securityHeaders, sameOrigin, need, can } from "./auth.js";

export const api = express.Router();
api.use(express.json({ limit: "100kb" }));
api.use(securityHeaders, sameOrigin);
api.use(authPublic);          // sign-in / sign-out / who am I
api.use(requireAuth);         // everything below needs a valid session
api.use(authPrivate);         // password change, user management

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg) => { throw new HttpError(400, msg); };
const notFound = (what) => { throw new HttpError(404, `${what} not found`); };
const wrap = (fn) => (req, res) => {
  try { res.json(fn(req, res)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message }); if (!e.status) console.error(e); }
};
const num = (v, name, { min = 0, int = false } = {}) => {
  const n = Number(v);
  if (v === "" || v == null || !Number.isFinite(n) || n < min) bad(`${name} must be a number ≥ ${min}`);
  return int ? Math.round(n) : n;
};
const FIELD_NAMES = { w: "width", l: "height", g: "gusset", gsm: "GSM", bag_type: "bag type", print_colors: "printing", loop_color: "handle colour",
  client_id: "client", qty: "quantity", due_date: "delivery date", vendor_id: "supplier", size_in: "width", length_m: "length", net_kg: "weight", expected_on: "expected date" };
const fieldList = (keys) => keys.map((k) => FIELD_NAMES[k] || k).join(", ");
const str = (v, name) => { if (!v || !String(v).trim()) bad(`${name} is required`); return String(v).trim(); };

// ───────────────────────── Order progress ─────────────────────────

export const STAGES = [
  { key: "fabric", label: "Awaiting fabric" },
  { key: "printing", label: "Printing" },
  { key: "cutting", label: "Cutting" },
  { key: "packing", label: "Packing" },
  { key: "ready", label: "Ready to ship" },
  { key: "delivered", label: "Delivered" },
];

function enrich(orders) {
  if (!orders.length) return [];
  const ids = orders.map((o) => o.id);
  const q = `(${ids.map(() => "?").join(",")})`;
  const rolls = all(`SELECT * FROM rolls WHERE order_id IN ${q}`, ...ids);
  const sacks = all(`SELECT order_id, status, SUM(pieces) pcs, COUNT(*) n FROM sacks WHERE order_id IN ${q} GROUP BY order_id, status`, ...ids);
  return orders.map((o) => {
    const bag = { w: o.w, l: o.l, g: o.g };
    const mine = rolls.filter((r) => r.order_id === o.id);
    const s = (st) => sacks.filter((x) => x.order_id === o.id && (!st || x.status === st)).reduce((a, x) => a + x.pcs, 0);
    const p = {
      rolls: mine.length,
      printed: mine.filter((r) => r.printed_on).length,
      cut: mine.filter((r) => r.cut_on).length,
      bookedPieces: mine.reduce((a, r) => a + bagsFromRoll(o.bag_type, bag, r), 0),
      cutPieces: mine.reduce((a, r) => a + (r.bags_out || 0), 0),
      packed: s(),
      inGodown: s("godown"),
      dispatched: s("dispatched"),
    };
    let stage;
    if (o.status === "delivered" || p.dispatched >= o.qty) stage = "delivered";
    else if (p.packed >= o.qty) stage = "ready";
    else if (p.rolls && p.cut === p.rolls) stage = "packing";
    else if (p.rolls && p.printed === p.rolls) stage = "cutting";
    else if (p.rolls && p.bookedPieces >= o.qty * 0.98) stage = "printing";
    else stage = "fabric";
    if (stage === "printing" && p.cut > 0) stage = "cutting";
    const stageIdx = STAGES.findIndex((x) => x.key === stage);
    const daysLeft = Math.round((new Date(o.due_date) - new Date(today())) / 864e5);
    return {
      ...o, bag_type_name: BAG_TYPES[o.bag_type].name, progress: p, stage, stageIdx,
      stageLabel: STAGES[stageIdx].label, daysLeft,
      late: stage !== "delivered" && daysLeft < 0,
      size: `${o.w} × ${o.l}${o.g ? ` × ${o.g}` : ""}`,
    };
  });
}

const ORDER_SQL = `SELECT o.*, c.name client, c.city, c.agent FROM orders o JOIN clients c ON c.id = o.client_id`;
const getOrder = (id) => enrich([one(`${ORDER_SQL} WHERE o.id = ?`, id) || notFound("Order")])[0];

// ───────────────────────── Fabric position ─────────────────────────

function fabricPosition(openOrders) {
  const free = all(`SELECT color, size_in, gsm, quality, status, SUM(net_kg) kg, COUNT(*) n, MIN(expected_on) next_eta
                    FROM rolls WHERE order_id IS NULL AND status IN ('stock','transit') GROUP BY 1,2,3,4,5`);
  const limits = all("SELECT * FROM roll_limits");
  const key = (r) => `${r.color}|${r.size_in}|${r.gsm}|${r.quality}`;
  const rows = new Map();
  const row = (r) => {
    const k = key(r);
    if (!rows.has(k)) rows.set(k, { color: r.color, size_in: r.size_in, gsm: r.gsm, quality: r.quality, stock_kg: 0, stock_rolls: 0, transit_kg: 0, transit_rolls: 0, next_eta: null, min_kg: 0, demand_kg: 0, demand_orders: [] });
    return rows.get(k);
  };
  limits.forEach((l) => (row(l).min_kg = l.min_kg));
  free.forEach((f) => {
    const r = row(f);
    if (f.status === "stock") { r.stock_kg += f.kg; r.stock_rolls += f.n; }
    else { r.transit_kg += f.kg; r.transit_rolls += f.n; r.next_eta = f.next_eta; }
  });
  // Demand: open orders still short of fabric, matched to the roll width they need.
  openOrders.filter((o) => o.stage === "fabric").forEach((o) => {
    const [rmin] = rollSizeRange(o.bag_type, o);
    const missingPieces = Math.max(0, o.qty - o.progress.bookedPieces);
    const kg = fabricKgForOrder(o.bag_type, o, rmin, o.gsm, missingPieces);
    const r = row({ color: o.color, size_in: rmin, gsm: o.gsm, quality: o.quality });
    r.demand_kg += kg; r.demand_orders.push(o.order_no);
  });
  return [...rows.values()].map((r) => {
    const stock = Math.round(r.stock_kg), transit = Math.round(r.transit_kg), demand = Math.round(r.demand_kg);
    let status = "ok";
    if (stock < demand || stock < r.min_kg) status = stock + transit >= Math.max(demand, r.min_kg) ? "covered" : "short";
    else if (stock < r.min_kg * 1.5 && r.min_kg) status = "low";
    return { ...r, stock_kg: stock, transit_kg: transit, demand_kg: demand, status, label: `${r.color} · ${r.size_in}″ · ${r.gsm} GSM` };
  }).sort((a, b) => ["short", "covered", "low", "ok"].indexOf(a.status) - ["short", "covered", "low", "ok"].indexOf(b.status) || b.demand_kg - a.demand_kg);
}

// ───────────────────────── Dashboard ─────────────────────────

api.get("/dashboard", wrap(() => {
  const t = today();
  const open = enrich(all(`${ORDER_SQL} WHERE o.status = 'open' ORDER BY o.due_date`));
  const live = open.filter((o) => o.stage !== "delivered");

  const days = Array.from({ length: 7 }, (_, i) => addDays(i));
  const schedule = {
    overdue: live.filter((o) => o.due_date < t),
    days: days.map((d) => ({ date: d, orders: live.filter((o) => o.due_date === d) })),
    later: live.filter((o) => o.due_date > days[6]).length,
  };

  const rollAgg = (where) => one(`SELECT COUNT(*) n, COALESCE(SUM(net_kg),0) kg FROM rolls WHERE ${where}`);
  const sackAgg = (st) => one(`SELECT COUNT(*) n, COALESCE(SUM(pieces),0) pcs FROM sacks s JOIN orders o ON o.id=s.order_id WHERE s.status = ? AND o.status='open'`, st);
  const cutNotPacked = live.reduce((a, o) => a + Math.max(0, o.progress.cutPieces - o.progress.packed), 0);
  const pipeline = [
    { key: "fabric", label: "Awaiting fabric", value: live.filter((o) => o.stage === "fabric").length, unit: "orders", hint: "Not enough rolls booked yet" },
    { key: "print", label: "To print", ...((r) => ({ value: r.n, unit: "rolls", hint: `${Math.round(r.kg).toLocaleString("en-IN")} kg booked` }))(rollAgg("order_id IS NOT NULL AND printed_on IS NULL")) },
    { key: "cut", label: "To cut", ...((r) => ({ value: r.n, unit: "rolls", hint: `${Math.round(r.kg).toLocaleString("en-IN")} kg printed` }))(rollAgg("printed_on IS NOT NULL AND cut_on IS NULL")) },
    { key: "pack", label: "To pack", value: cutNotPacked, unit: "bags", hint: "Cut, waiting for sacks" },
    { key: "factory", label: "Packed · factory", ...((s) => ({ value: s.n, unit: "sacks", hint: `${s.pcs.toLocaleString("en-IN")} bags` }))(sackAgg("factory")) },
    { key: "godown", label: "In godown", ...((s) => ({ value: s.n, unit: "sacks", hint: `${s.pcs.toLocaleString("en-IN")} bags` }))(sackAgg("godown")) },
  ];

  const machines = all("SELECT * FROM machines WHERE active = 1 ORDER BY kind DESC, id").map((m) => {
    const isP = m.kind === "printing";
    const done = one(`SELECT COUNT(*) n, COALESCE(SUM(bags_out),0) bags FROM rolls WHERE ${isP ? "print_machine_id" : "cut_machine_id"} = ? AND ${isP ? "printed_on" : "cut_on"} = ?`, m.id, t);
    const week = one(`SELECT COUNT(*) n FROM rolls WHERE ${isP ? "print_machine_id" : "cut_machine_id"} = ? AND ${isP ? "printed_on" : "cut_on"} > ?`, m.id, addDays(-7));
    return { ...m, today: done.n, bagsToday: done.bags, weekAvg: +(week.n / 7).toFixed(1) };
  });
  const queues = {
    printing: one("SELECT COUNT(*) n FROM rolls WHERE order_id IS NOT NULL AND printed_on IS NULL").n,
    cutting: one("SELECT COUNT(*) n FROM rolls WHERE printed_on IS NOT NULL AND cut_on IS NULL").n,
  };

  const cutByDay = Object.fromEntries(all("SELECT cut_on d, SUM(bags_out) bags, COUNT(*) rolls FROM rolls WHERE cut_on > ? GROUP BY cut_on", addDays(-7)).map((r) => [r.d, r]));
  const output = Array.from({ length: 7 }, (_, i) => addDays(i - 6)).map((d) => ({ date: d, bags: cutByDay[d]?.bags || 0, rolls: cutByDay[d]?.rolls || 0 }));
  const stageCounts = STAGES.slice(0, 5).map((st) => ({ key: st.key, label: st.label, count: live.filter((o) => o.stage === st.key).length, late: live.filter((o) => o.stage === st.key && o.late).length }));

  const w = one("SELECT COALESCE(SUM(waste_kg),0) waste, COALESCE(SUM(net_kg),0) kg FROM rolls WHERE cut_on > ?", addDays(-7));
  const fabric = fabricPosition(open);
  const plan = buildPlan().summary;

  return {
    today: t,
    headline: {
      overdue: schedule.overdue.length,
      dueToday: schedule.days[0].orders.length,
      dueWeek: schedule.days.reduce((a, d) => a + d.orders.length, 0),
      open: live.length,
      shortFabric: fabric.filter((f) => f.status === "short").length,
      lowLoops: all("SELECT COUNT(*) n FROM loops WHERE balance_kg < min_kg")[0].n,
      wastePct: w.kg ? +((w.waste / w.kg) * 100).toFixed(1) : 0,
      delivered30: one("SELECT COUNT(*) n FROM orders WHERE status='delivered' AND delivered_on > ?", addDays(-30)).n,
    },
    schedule, pipeline, machines, queues, fabric, output, stageCounts,
    atRisk: plan.atRisk.filter((o) => o.due_date >= t), blocked: plan.blocked,
    loops: all("SELECT * FROM loops ORDER BY balance_kg / NULLIF(min_kg,0)"),
  };
}));

api.get("/activity", need("activity"), wrap(() => all("SELECT * FROM activity ORDER BY ts DESC, id DESC LIMIT 100")));

// ───────────────────────── Orders ─────────────────────────

const hideMoney = (req, o) => (can(req.user, "money") ? o : { ...o, rate: null });

api.get("/orders", wrap((req) => {
  const { status = "open", q } = req.query;
  let rows = enrich(all(`${ORDER_SQL} WHERE (? = 'all' OR o.status = ?) ORDER BY o.due_date`, status, status));
  if (q) { const s = String(q).toLowerCase(); rows = rows.filter((o) => `${o.order_no} ${o.client} ${o.color}`.toLowerCase().includes(s)); }
  return rows.map((o) => hideMoney(req, o));
}));

api.get("/orders/:id", wrap((req) => {
  const o = hideMoney(req, getOrder(req.params.id));
  return {
    ...o,
    cylinder: cylinderSize(o.bag_type, o),
    rollSize: rollSizeRange(o.bag_type, o),
    rolls: all(`SELECT r.*, pm.name print_machine, cm.name cut_machine FROM rolls r
                LEFT JOIN machines pm ON pm.id=r.print_machine_id LEFT JOIN machines cm ON cm.id=r.cut_machine_id
                WHERE r.order_id = ? ORDER BY r.id`, o.id).map((r) => ({ ...r, est_bags: bagsFromRoll(o.bag_type, o, r) })),
    sacks: all("SELECT s.*, c.challan_no FROM sacks s LEFT JOIN challans c ON c.id = s.challan_id WHERE s.order_id = ? ORDER BY s.id", o.id),
    candidates: candidateRolls(o).slice(0, 12),
    forecast: buildPlan().orders[o.id] || null,
  };
}));

api.post("/orders/preview", wrap((req) => orderPreview(req.body)));

api.post("/orders", need("orders"), wrap((req) => {
  const b = req.body;
  if (!BAG_TYPES[b.bag_type]) bad("Choose a bag type");
  const client_id = num(b.client_id, "Client", { min: 1, int: true });
  if (!one("SELECT id FROM clients WHERE id = ? AND active = 1", client_id)) bad("Unknown or inactive client");
  const w = num(b.w, "Width", { min: 1 }), l = num(b.l, "Height", { min: 1 });
  const g = b.bag_type === "box" ? num(b.g, "Gusset", { min: 1 }) : 0;
  const gsm = num(b.gsm, "GSM", { min: 20, int: true });
  const qty = num(b.qty, "Quantity", { min: 1, int: true });
  const due = str(b.due_date, "Delivery date");
  if (due < today()) bad("Delivery date can't be in the past");
  const last = one("SELECT order_no FROM orders ORDER BY id DESC LIMIT 1");
  const order_no = `EG-${last ? Number(last.order_no.split("-")[1]) + 1 : 2401}`;
  const id = run(`INSERT INTO orders (order_no, client_id, bag_type, w, l, g, gsm, color, quality, print_colors, loop_color, qty, rate, order_date, due_date, notes)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    order_no, client_id, b.bag_type, w, l, g, gsm, str(b.color, "Colour"), b.quality || "Standard",
    b.print_colors || null, BAG_TYPES[b.bag_type].hasLoop ? b.loop_color || null : null,
    qty, b.rate ? num(b.rate, "Rate") : null, today(), due, b.notes || null).lastInsertRowid;
  const c = one("SELECT name FROM clients WHERE id=?", client_id);
  log("order", `New order ${order_no} from ${c.name} · ${qty.toLocaleString("en-IN")} ${BAG_TYPES[b.bag_type].name}`);
  return { id, order_no };
}));

function candidateRolls(o) {
  if (o.status !== "open") return [];
  const [rmin, rmax] = rollSizeRange(o.bag_type, o);
  return all(`SELECT * FROM rolls WHERE order_id IS NULL AND status = 'stock' AND color = ? AND gsm = ? AND quality = ?
              AND size_in BETWEEN ? AND ? ORDER BY ABS(size_in - ?), received_on`, o.color, o.gsm, o.quality, rmin, rmax, rmin)
    .map((r) => ({ ...r, est_bags: bagsFromRoll(o.bag_type, o, r) }));
}

api.post("/orders/:id/book", need("orders"), wrap((req) => {
  const o = getOrder(req.params.id);
  if (o.status !== "open") bad("Order is closed");
  const ids = Array.isArray(req.body.roll_ids) ? req.body.roll_ids.map(Number) : null;
  const cands = candidateRolls(o);
  let chosen;
  if (ids) {
    chosen = cands.filter((r) => ids.includes(r.id));
    if (chosen.length !== ids.length) bad("Some rolls are no longer available or don't match this order");
  } else {
    let need = o.qty - o.progress.bookedPieces; chosen = [];
    for (const r of cands) { if (need <= 0) break; chosen.push(r); need -= r.est_bags; }
    if (!chosen.length) bad("No matching rolls in stock");
  }
  tx(() => chosen.forEach((r) => run("UPDATE rolls SET order_id = ? WHERE id = ? AND order_id IS NULL", o.id, r.id)));
  log("stock", `${chosen.length} roll${chosen.length > 1 ? "s" : ""} booked for ${o.order_no}`);
  return getOrder(o.id);
}));

api.post("/orders/:id/unbook/:rollId", need("orders"), wrap((req) => {
  const r = one("SELECT * FROM rolls WHERE id = ? AND order_id = ?", req.params.rollId, req.params.id) || notFound("Roll");
  if (r.printed_on) bad("Roll is already printed for this order. Undo the printing first");
  run("UPDATE rolls SET order_id = NULL WHERE id = ?", r.id);
  const o = one("SELECT order_no FROM orders WHERE id=?", req.params.id);
  log("stock", `${r.roll_no} released from ${o.order_no}`);
  return { ok: true };
}));

/** Change an order. Bag spec is locked once fabric is printed; dates, quantity, price and notes stay editable. */
api.post("/orders/:id/edit", need("orders"), wrap((req) => {
  const o = getOrder(req.params.id);
  if (o.status === "cancelled") bad("Reopen the order before editing it");
  const b = req.body;
  const specLocked = o.progress.printed > 0;
  const v = {
    client_id: num(b.client_id ?? o.client_id, "Client", { min: 1, int: true }),
    bag_type: b.bag_type ?? o.bag_type,
    w: num(b.w ?? o.w, "Width", { min: 1 }), l: num(b.l ?? o.l, "Height", { min: 1 }), g: num(b.g ?? o.g ?? 0, "Gusset"),
    gsm: num(b.gsm ?? o.gsm, "GSM", { min: 20, int: true }), color: str(b.color ?? o.color, "Colour"), quality: b.quality || o.quality,
    print_colors: b.print_colors ?? o.print_colors, loop_color: b.loop_color ?? o.loop_color,
    qty: num(b.qty ?? o.qty, "Quantity", { min: 1, int: true }),
    // Omitted → unchanged (people who can't see prices never send it); empty → cleared.
    rate: b.rate === undefined ? o.rate : b.rate === "" || b.rate === null ? null : num(b.rate, "Rate"),
    due_date: str(b.due_date ?? o.due_date, "Delivery date"), notes: b.notes ?? o.notes,
  };
  if (!BAG_TYPES[v.bag_type]) bad("Choose a bag type");
  if (v.bag_type === "box" && !v.g) bad("Box bags need a gusset");
  if (!one("SELECT id FROM clients WHERE id = ?", v.client_id)) bad("Unknown client");
  const specKeys = ["bag_type", "w", "l", "g", "gsm", "color", "quality", "print_colors", "loop_color"];
  const specChanged = specKeys.filter((k) => String(v[k] ?? "") !== String(o[k] ?? ""));
  if (specLocked && specChanged.length) bad(`Fabric for this order is already printed, so ${fieldList(specChanged)} can't change`);
  if (o.progress.rolls && specChanged.some((k) => ["color", "gsm", "quality", "bag_type", "w", "l", "g"].includes(k)))
    bad("Rolls are booked for this order. Release them before changing the bag or fabric");
  if (v.qty < o.progress.packed) bad(`${o.progress.packed.toLocaleString("en-IN")} bags are already packed; quantity can't be lower`);
  if (!BAG_TYPES[v.bag_type].hasLoop) v.loop_color = null;
  run(`UPDATE orders SET client_id=?, bag_type=?, w=?, l=?, g=?, gsm=?, color=?, quality=?, print_colors=?, loop_color=?, qty=?, rate=?, due_date=?, notes=? WHERE id=?`,
    v.client_id, v.bag_type, v.w, v.l, v.g, v.gsm, v.color, v.quality, v.print_colors, v.loop_color, v.qty, v.rate, v.due_date, v.notes, o.id);
  const changed = Object.keys(v).filter((k) => String(v[k] ?? "") !== String(o[k] ?? ""));
  if (changed.length) log("order", `${o.order_no} edited (${fieldList(changed)})`);
  return getOrder(o.id);
}));

/** Close an order that won't be fully dispatched (e.g. client accepted a short delivery). */
api.post("/orders/:id/close", need("orders"), wrap((req) => {
  const o = getOrder(req.params.id);
  if (o.status !== "open") bad("Order isn't open");
  const note = str(req.body.note, "Reason");
  run("UPDATE orders SET status='delivered', delivered_on=?, close_note=? WHERE id=?", today(), note, o.id);
  log("order", `${o.order_no} closed as delivered: ${note}`);
  return { ok: true };
}));

/** Reopen a cancelled or delivered order. */
api.post("/orders/:id/reopen", need("orders"), wrap((req) => {
  const o = one("SELECT * FROM orders WHERE id = ?", req.params.id) || notFound("Order");
  if (o.status === "open") bad("Order is already open");
  run("UPDATE orders SET status='open', delivered_on=NULL, close_note=NULL WHERE id=?", o.id);
  log("order", `${o.order_no} reopened (was ${o.status})`);
  return { ok: true };
}));

/** Undo packing: remove sacks that are still at the factory. */
api.post("/sacks/unpack", need("pack"), wrap((req) => {
  const ids = (req.body.ids || []).map(Number);
  if (!ids.length) bad("Select sacks to unpack");
  const sacks = all(`SELECT s.*, o.order_no FROM sacks s JOIN orders o ON o.id = s.order_id WHERE s.id IN (${ids.map(() => "?").join(",")})`, ...ids);
  if (sacks.length !== ids.length) bad("Some sacks no longer exist");
  if (sacks.some((s) => s.status !== "factory")) bad("Only sacks still at the factory can be unpacked. Move them back first");
  tx(() => sacks.forEach((s) => run("DELETE FROM sacks WHERE id=?", s.id)));
  log("pack", `Undo: ${sacks.length} sack${sacks.length > 1 ? "s" : ""} unpacked for ${[...new Set(sacks.map((s) => s.order_no))].join(", ")}`);
  return { ok: true };
}));

api.post("/orders/:id/pack", need("pack"), wrap((req) => {
  const o = getOrder(req.params.id);
  const sacks = num(req.body.sacks, "Number of sacks", { min: 1, int: true });
  const per = num(req.body.pieces, "Bags per sack", { min: 1, int: true });
  const kg = num(req.body.kg, "Weight per sack", { min: 0.1 });
  const available = o.progress.cutPieces - o.progress.packed;
  if (sacks * per > available) bad(`Only ${available.toLocaleString("en-IN")} cut bags are waiting to be packed`);
  const last = one("SELECT sack_no FROM sacks ORDER BY id DESC LIMIT 1");
  let n = last ? Number(last.sack_no.split("-")[1]) : 0;
  tx(() => { for (let i = 0; i < sacks; i++) run("INSERT INTO sacks (sack_no, order_id, pieces, kg, packed_on) VALUES (?,?,?,?,?)", `S-${String(++n).padStart(5, "0")}`, o.id, per, kg, today()); });
  log("pack", `${sacks} sack${sacks > 1 ? "s" : ""} packed for ${o.order_no}`);
  return getOrder(o.id);
}));

api.post("/orders/:id/cancel", need("orders"), wrap((req) => {
  const o = getOrder(req.params.id);
  if (o.progress.printed) bad("Rolls are already printed for this order; it can't be cancelled here");
  tx(() => { run("UPDATE rolls SET order_id = NULL WHERE order_id = ?", o.id); run("UPDATE orders SET status = 'cancelled' WHERE id = ?", o.id); });
  log("order", `${o.order_no} cancelled`);
  return { ok: true };
}));

// ───────────────────────── Rolls ─────────────────────────

api.get("/rolls", wrap((req) => {
  const view = req.query.view || "stock";
  const where = {
    stock: "r.status = 'stock' AND r.order_id IS NULL",
    booked: "r.order_id IS NOT NULL AND r.cut_on IS NULL",
    transit: "r.status = 'transit'",
    used: "r.cut_on IS NOT NULL",
  }[view] || bad("Unknown view");
  return all(`SELECT r.*, v.name vendor, o.order_no FROM rolls r LEFT JOIN vendors v ON v.id = r.vendor_id
              LEFT JOIN orders o ON o.id = r.order_id WHERE ${where} ORDER BY ${view === "used" ? "r.cut_on DESC" : "r.color, r.size_in, r.gsm"} LIMIT 400`);
}));

api.post("/rolls/purchase", need("stock"), wrap((req) => {
  const b = req.body;
  const vendor_id = num(b.vendor_id, "Supplier", { min: 1, int: true });
  if (!one("SELECT id FROM vendors WHERE id = ? AND active = 1", vendor_id)) bad("Unknown or inactive supplier");
  const count = num(b.count, "Number of rolls", { min: 1, int: true });
  if (count > 200) bad("That's a lot of rolls — enter at most 200 at a time");
  const size = num(b.size_in, "Roll width", { min: 1 }), gsm = num(b.gsm, "GSM", { min: 20, int: true });
  const length = num(b.length_m, "Length", { min: 1 }), kg = num(b.net_kg, "Weight", { min: 1 });
  const color = str(b.color, "Colour");
  const last = one("SELECT roll_no FROM rolls ORDER BY id DESC LIMIT 1");
  let n = last ? Number(last.roll_no.split("-")[1]) : 0;
  tx(() => { for (let i = 0; i < count; i++) run(`INSERT INTO rolls (roll_no, vendor_id, color, size_in, gsm, quality, length_m, net_kg, status, purchased_on, expected_on)
      VALUES (?,?,?,?,?,?,?,?, 'transit', ?, ?)`, `R-${String(++n).padStart(4, "0")}`, vendor_id, color, size, gsm, b.quality || "Standard", length, kg, today(), b.expected_on || addDays(3)); });
  const v = one("SELECT name FROM vendors WHERE id=?", vendor_id);
  log("stock", `${count} ${color} rolls ordered from ${v?.name}`);
  return { ok: true };
}));

api.post("/rolls/receive", need("stock"), wrap((req) => {
  const ids = (req.body.ids || []).map(Number);
  if (!ids.length) bad("Select at least one roll");
  const res = tx(() => ids.reduce((a, id) => a + Number(run("UPDATE rolls SET status='stock', received_on=? WHERE id=? AND status='transit'", today(), id).changes), 0));
  log("stock", `${res} roll${res > 1 ? "s" : ""} received into stock`);
  return { received: res };
}));

/** Correct a roll's details (e.g. the actual weight on the supplier's slip). Locked once printing starts. */
api.post("/rolls/:id/edit", need("stock"), wrap((req) => {
  const r = one("SELECT * FROM rolls WHERE id = ?", req.params.id) || notFound("Roll");
  if (r.printed_on) bad("This roll is already printed; its details are locked");
  const b = req.body;
  const v = {
    vendor_id: num(b.vendor_id ?? r.vendor_id, "Supplier", { min: 1, int: true }),
    color: str(b.color ?? r.color, "Colour"),
    size_in: num(b.size_in ?? r.size_in, "Width", { min: 1 }),
    gsm: num(b.gsm ?? r.gsm, "GSM", { min: 20, int: true }),
    quality: b.quality || r.quality,
    length_m: num(b.length_m ?? r.length_m, "Length", { min: 1 }),
    net_kg: num(b.net_kg ?? r.net_kg, "Weight", { min: 1 }),
    expected_on: b.expected_on ?? r.expected_on,
  };
  if (r.order_id && (v.color !== r.color || v.gsm !== r.gsm || v.quality !== r.quality || v.size_in !== r.size_in))
    bad("This roll is booked to an order. Release it before changing colour, width, GSM or quality");
  run(`UPDATE rolls SET vendor_id=?, color=?, size_in=?, gsm=?, quality=?, length_m=?, net_kg=?, expected_on=? WHERE id=?`,
    v.vendor_id, v.color, v.size_in, v.gsm, v.quality, v.length_m, v.net_kg, v.expected_on, r.id);
  const changed = Object.keys(v).filter((k) => String(v[k]) !== String(r[k]));
  if (changed.length) log("stock", `${r.roll_no} corrected (${fieldList(changed)})`);
  return { ok: true };
}));

/** Undo "received": back to incoming. Not allowed once it's booked to an order. */
api.post("/rolls/unreceive", need("stock"), wrap((req) => {
  const ids = (req.body.ids || []).map(Number);
  if (!ids.length) bad("Select at least one roll");
  const rolls = all(`SELECT r.*, o.order_no FROM rolls r LEFT JOIN orders o ON o.id = r.order_id WHERE r.id IN (${ids.map(() => "?").join(",")})`, ...ids);
  const booked = rolls.filter((r) => r.order_id);
  if (booked.length) bad(`${booked.map((r) => `${r.roll_no} (${r.order_no})`).join(", ")} ${booked.length > 1 ? "are" : "is"} booked to an order. Release first`);
  if (rolls.some((r) => r.status !== "stock")) bad("Only rolls in stock can be marked not received");
  tx(() => rolls.forEach((r) => run("UPDATE rolls SET status='transit', received_on=NULL WHERE id=?", r.id)));
  log("stock", `Undo: ${rolls.map((r) => r.roll_no).join(", ")} marked not received`);
  return { ok: true };
}));

/** Remove incoming rolls that were entered by mistake or that the supplier cancelled. */
api.post("/rolls/cancel-incoming", need("stock"), wrap((req) => {
  const ids = (req.body.ids || []).map(Number);
  if (!ids.length) bad("Select at least one roll");
  const rolls = all(`SELECT * FROM rolls WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
  if (rolls.some((r) => r.status !== "transit" || r.order_id)) bad("Only incoming rolls that haven't been received can be removed");
  tx(() => rolls.forEach((r) => run("DELETE FROM rolls WHERE id=?", r.id)));
  log("stock", `Incoming rolls removed: ${rolls.map((r) => r.roll_no).join(", ")}`);
  return { ok: true };
}));

// ───────────────────────── Production ─────────────────────────

api.get("/production", wrap(() => {
  const base = `SELECT r.*, o.order_no, o.bag_type, o.w, o.l, o.g, o.due_date, o.print_colors, c.name client
                FROM rolls r JOIN orders o ON o.id = r.order_id JOIN clients c ON c.id = o.client_id`;
  const plan = buildPlan();
  const add = (r) => ({ ...r, bag_type_name: BAG_TYPES[r.bag_type].name, cylinder: cylinderSize(r.bag_type, r), colours: coloursNeeded(r.print_colors),
    est_bags: bagsFromRoll(r.bag_type, r, r), suggest: plan.rolls[r.id] || null });
  const machines = all("SELECT * FROM machines WHERE active = 1 ORDER BY id");
  return {
    machines,
    summary: plan.summary,
    toPrint: all(`${base} WHERE r.printed_on IS NULL AND r.status = 'stock' AND o.status = 'open' ORDER BY o.due_date, r.id`).map(add),
    toCut: all(`${base} WHERE r.printed_on IS NOT NULL AND r.cut_on IS NULL AND o.status = 'open' ORDER BY o.due_date, r.id`).map(add),
    doneToday: all(`${base.replace("SELECT r.*", "SELECT r.*, pm.name print_machine, cm.name cut_machine")} LEFT JOIN machines pm ON pm.id=r.print_machine_id LEFT JOIN machines cm ON cm.id=r.cut_machine_id
                    WHERE r.printed_on = ? OR r.cut_on = ? ORDER BY r.id DESC`, today(), today()).map(add),
  };
}));

api.post("/rolls/:id/print", need("production"), wrap((req) => {
  const r = one("SELECT * FROM rolls WHERE id = ?", req.params.id) || notFound("Roll");
  if (!r.order_id) bad("Book the roll to an order before printing");
  if (r.status !== "stock") bad("Roll hasn't been received yet");
  if (r.printed_on) bad("Already printed");
  const m = one("SELECT * FROM machines WHERE id = ? AND kind = 'printing' AND active = 1", req.body.machine_id) || bad("Choose a printing machine");
  const job = one("SELECT bag_type, w, l, g, print_colors FROM orders WHERE id = ?", r.order_id);
  const why = canPrint(m, { ...job, cylinder: cylinderSize(job.bag_type, job) });
  if (why) bad(`${m.name} can't do this job: ${why}`);
  const kg = req.body.print_kg ? num(req.body.print_kg, "Weight after print", { min: 1 }) : r.net_kg;
  run("UPDATE rolls SET print_machine_id=?, printed_on=?, print_kg=? WHERE id=?", m.id, today(), kg, r.id);
  log("print", `${r.roll_no} printed on ${m.name}`);
  return { ok: true };
}));

api.post("/rolls/:id/cut", need("production"), wrap((req) => {
  const r = one("SELECT * FROM rolls WHERE id = ?", req.params.id) || notFound("Roll");
  if (!r.printed_on) bad("Roll must be printed before cutting");
  if (r.cut_on) bad("Already cut");
  const m = one("SELECT * FROM machines WHERE id = ? AND kind = 'cutting' AND active = 1", req.body.machine_id) || bad("Choose a cutting machine");
  const cutWhy = canCut(m, one("SELECT bag_type FROM orders WHERE id = ?", r.order_id));
  if (cutWhy) bad(`${m.name} can't do this job: ${cutWhy}`);
  const bags = num(req.body.bags_out, "Bags produced", { min: 1, int: true });
  const waste = num(req.body.waste_kg, "Waste", { min: 0 });
  if (waste > r.net_kg) bad("Waste can't exceed the roll's weight");
  // Loop and box bags use handles: take them out of handle stock (restored if the cut is undone).
  const o = one("SELECT bag_type, loop_color FROM orders WHERE id = ?", r.order_id);
  const loop = BAG_TYPES[o.bag_type].hasLoop && o.loop_color ? one("SELECT * FROM loops WHERE color = ?", o.loop_color) : null;
  const loopKg = loop ? +((bags * LOOP_WEIGHT_G) / 1000).toFixed(2) : null;
  tx(() => {
    run("UPDATE rolls SET cut_machine_id=?, cut_on=?, bags_out=?, waste_kg=?, loop_kg=? WHERE id=?", m.id, today(), bags, waste, loopKg, r.id);
    if (loop) run("UPDATE loops SET balance_kg = balance_kg - ? WHERE id = ?", loopKg, loop.id);
  });
  log("cut", `${r.roll_no} cut on ${m.name} · ${bags.toLocaleString("en-IN")} bags${loop ? ` · ${loopKg} kg ${loop.color} handles used` : ""}`);
  return { ok: true };
}));

// ── Undo production steps ──
api.post("/rolls/:id/unprint", need("production"), wrap((req) => {
  const r = one("SELECT * FROM rolls WHERE id = ?", req.params.id) || notFound("Roll");
  if (!r.printed_on) bad("Roll isn't marked printed");
  if (r.cut_on) bad("Undo the cutting first");
  run("UPDATE rolls SET print_machine_id=NULL, printed_on=NULL, print_kg=NULL WHERE id=?", r.id);
  log("print", `Undo: ${r.roll_no} no longer marked printed`);
  return { ok: true };
}));

api.post("/rolls/:id/uncut", need("production"), wrap((req) => {
  const r = one("SELECT * FROM rolls WHERE id = ?", req.params.id) || notFound("Roll");
  if (!r.cut_on) bad("Roll isn't marked cut");
  const o = getOrder(r.order_id);
  const unpacked = o.progress.cutPieces - o.progress.packed;
  if (r.bags_out > unpacked) bad(`${o.order_no} already has these bags packed. Unpack ${(r.bags_out - unpacked).toLocaleString("en-IN")} bags first`);
  tx(() => {
    if (r.loop_kg && o.loop_color) run("UPDATE loops SET balance_kg = balance_kg + ? WHERE color = ?", r.loop_kg, o.loop_color);
    run("UPDATE rolls SET cut_machine_id=NULL, cut_on=NULL, bags_out=NULL, waste_kg=NULL, loop_kg=NULL WHERE id=?", r.id);
  });
  log("cut", `Undo: ${r.roll_no} no longer marked cut${r.loop_kg ? ` · ${r.loop_kg} kg handles returned to stock` : ""}`);
  return { ok: true };
}));

// ───────────────────────── Dispatch ─────────────────────────

api.get("/sacks", wrap(() => {
  const rows = all(`SELECT s.*, o.order_no, o.due_date, o.bag_type, c.name client, c.city FROM sacks s
                    JOIN orders o ON o.id = s.order_id JOIN clients c ON c.id = o.client_id
                    WHERE s.status != 'dispatched' ORDER BY o.due_date, s.id`);
  const groups = new Map();
  rows.forEach((s) => {
    const k = `${s.order_id}|${s.status}`;
    if (!groups.has(k)) groups.set(k, { order_id: s.order_id, order_no: s.order_no, client: s.client, city: s.city, due_date: s.due_date, status: s.status, sacks: [], pieces: 0, kg: 0 });
    const g = groups.get(k); g.sacks.push(s.id); g.pieces += s.pieces; g.kg += s.kg;
  });
  return {
    groups: [...groups.values()],
    challans: all(`SELECT ch.*, COUNT(cs.sack_id) sacks, SUM(cs.pieces) pieces, GROUP_CONCAT(DISTINCT o.order_no) orders,
                          (SELECT COUNT(*) FROM sacks s WHERE s.challan_id = ch.id) current
                   FROM challans ch LEFT JOIN challan_sacks cs ON cs.challan_id = ch.id LEFT JOIN orders o ON o.id = cs.order_id
                   GROUP BY ch.id ORDER BY ch.id DESC LIMIT 20`).map((c) => ({ ...c, canCancel: !c.cancelled_on && c.current > 0 })),
  };
}));

const MOVES = {
  godown: { from: ["factory"], kind: "Factory → Godown", verb: "to godown" },
  factory: { from: ["godown"], kind: "Godown → Factory", verb: "back to factory" },
  dispatched: { from: ["factory", "godown"], kind: "To client", verb: "dispatched to client" },
};

function nextChallanNo() {
  const last = one("SELECT challan_no FROM challans ORDER BY id DESC LIMIT 1");
  return `CH-${String((last ? Number(last.challan_no.split("-")[1]) : 0) + 1).padStart(4, "0")}`;
}

/** Open orders close themselves once every bag is dispatched; cancelled challans reopen them. */
function syncDelivered(orderIds) {
  orderIds.forEach((oid) => {
    const o = one("SELECT * FROM orders WHERE id=?", oid);
    const sent = one("SELECT COALESCE(SUM(pieces),0) p FROM sacks WHERE order_id=? AND status='dispatched'", oid).p;
    if (o.status === "open" && sent >= o.qty) { run("UPDATE orders SET status='delivered', delivered_on=? WHERE id=?", today(), oid); log("ship", `${o.order_no} fully delivered`); }
    else if (o.status === "delivered" && !o.close_note && sent < o.qty) { run("UPDATE orders SET status='open', delivered_on=NULL WHERE id=?", oid); log("ship", `${o.order_no} reopened (no longer fully delivered)`); }
  });
}

api.post("/sacks/move", need("dispatch"), wrap((req) => {
  const ids = (req.body.ids || []).map(Number);
  const move = MOVES[req.body.to] || bad("Unknown destination");
  if (!ids.length) bad("Select sacks to move");
  const sacks = all(`SELECT * FROM sacks WHERE id IN (${ids.map(() => "?").join(",")})`, ...ids);
  if (sacks.length !== ids.length) bad("Some sacks no longer exist");
  if (sacks.some((s) => !move.from.includes(s.status))) bad(`Some of those sacks can't go ${move.verb}`);
  const vehicle = str(req.body.vehicle, "Vehicle number");
  const challan_no = nextChallanNo();
  return tx(() => {
    const cid = run("INSERT INTO challans (challan_no, date, kind, vehicle, destination) VALUES (?,?,?,?,?)", challan_no, today(), move.kind, vehicle, req.body.destination || null).lastInsertRowid;
    sacks.forEach((s) => {
      run("UPDATE sacks SET prev_status=status, prev_challan_id=challan_id, status=?, challan_id=? WHERE id=?", req.body.to, cid, s.id);
      run("INSERT INTO challan_sacks (challan_id, sack_id, order_id, sack_no, pieces, kg) VALUES (?,?,?,?,?,?)", cid, s.id, s.order_id, s.sack_no, s.pieces, s.kg);
    });
    syncDelivered([...new Set(sacks.map((s) => s.order_id))]);
    log("ship", `Challan ${challan_no} · ${sacks.length} sacks ${move.verb}`);
    return { challan_no, id: Number(cid) };
  });
}));

/** Undo a challan made by mistake: its sacks go back to where they were. Only the latest move of those sacks can be undone. */
api.post("/challans/:id/cancel", need("dispatch"), wrap((req) => {
  const ch = one("SELECT * FROM challans WHERE id=?", req.params.id) || notFound("Challan");
  if (ch.cancelled_on) bad("Challan is already cancelled");
  const sacks = all("SELECT * FROM sacks WHERE challan_id=?", ch.id);
  if (!sacks.length) bad("These sacks have moved again since this challan. Cancel the later challan first");
  if (sacks.some((s) => !s.prev_status)) bad("No earlier location is recorded for these sacks, so this challan can't be undone automatically");
  const reason = str(req.body.reason, "Reason");
  return tx(() => {
    sacks.forEach((s) => run("UPDATE sacks SET status=prev_status, challan_id=prev_challan_id, prev_status=NULL, prev_challan_id=NULL WHERE id=?", s.id));
    run("UPDATE challans SET cancelled_on=? WHERE id=?", today(), ch.id);
    syncDelivered([...new Set(sacks.map((s) => s.order_id))]);
    log("ship", `Challan ${ch.challan_no} cancelled (${reason}) · ${sacks.length} sacks returned`);
    return { ok: true };
  });
}));

/** Everything needed to print a delivery challan. */
api.get("/challans/:id", wrap((req) => {
  const ch = one("SELECT * FROM challans WHERE id=?", req.params.id) || notFound("Challan");
  const items = all(`SELECT o.order_no, o.bag_type, o.w, o.l, o.g, o.gsm, o.color, o.print_colors, cs.order_id,
                            COUNT(*) sacks, SUM(cs.pieces) pieces, ROUND(SUM(cs.kg), 1) kg, GROUP_CONCAT(cs.sack_no, ', ') sack_nos
                     FROM challan_sacks cs JOIN orders o ON o.id = cs.order_id WHERE cs.challan_id = ? GROUP BY cs.order_id ORDER BY o.order_no`, ch.id)
    .map((i) => ({ ...i, description: `${BAG_TYPES[i.bag_type].name} bags ${i.w}×${i.l}${i.g ? `×${i.g}` : ""}″, ${i.color} ${i.gsm} GSM non-woven${i.print_colors ? `, ${i.print_colors}` : ""}` }));
  const clientIds = [...new Set(all("SELECT DISTINCT o.client_id FROM challan_sacks cs JOIN orders o ON o.id = cs.order_id WHERE cs.challan_id = ?", ch.id).map((r) => r.client_id))];
  const consignees = clientIds.map((id) => one("SELECT name, address, city, phone, gstin FROM clients WHERE id=?", id));
  return { challan: ch, items, consignees, company: Object.fromEntries(all("SELECT key, value FROM company").map((r) => [r.key, r.value])) };
}));

api.get("/company", wrap(() => Object.fromEntries(all("SELECT key, value FROM company").map((r) => [r.key, r.value]))));
api.post("/company", need("users"), wrap((req) => {
  for (const k of ["name", "address", "gstin", "phone", "hsn"]) if (req.body[k] !== undefined) run("INSERT OR REPLACE INTO company (key, value) VALUES (?, ?)", k, String(req.body[k]).trim());
  log("settings", "Company details updated");
  return { ok: true };
}));

// ───────────────────────── Masters ─────────────────────────

api.get("/meta", wrap(() => ({
  clients: all("SELECT * FROM clients ORDER BY name"),
  vendors: all("SELECT * FROM vendors ORDER BY name"),
  machines: all("SELECT * FROM machines ORDER BY id"),
  bagTypes: Object.entries(BAG_TYPES).map(([key, v]) => ({ key, ...v })),
  colors: all("SELECT DISTINCT color FROM rolls UNION SELECT color FROM orders ORDER BY 1").map((r) => r.color),
  loops: all("SELECT * FROM loops ORDER BY color"),
  limits: all("SELECT * FROM roll_limits ORDER BY color, size_in, gsm"),
})));

// Clients, suppliers and machines are never deleted (orders and rolls point at them); they're deactivated instead,
// which hides them from new-entry dropdowns but keeps history intact. Reactivating undoes it.
const activeFlag = (v, cur) => (v === undefined ? cur : v ? 1 : 0);

// ── Clients ── anyone who can take orders can register and update clients.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/;
const PHONE_RE = /^[+]?[0-9 -]{8,15}$/;
function clientFields(b, cur = {}) {
  const v = {
    name: str(b.name ?? cur.name, "Client name"),
    address: (b.address ?? cur.address ?? "").trim() || null,
    city: (b.city ?? cur.city ?? "").trim() || null,
    phone: (b.phone ?? cur.phone ?? "").trim() || null,
    agent: (b.agent ?? cur.agent ?? "").trim() || null,
    gstin: (b.gstin ?? cur.gstin ?? "").trim().toUpperCase() || null,
  };
  if (v.phone && !PHONE_RE.test(v.phone)) bad("Phone number doesn't look right");
  if (v.gstin && !GSTIN_RE.test(v.gstin)) bad("GSTIN should be 15 characters, e.g. 19ABCDE1234F1Z5");
  const dup = one("SELECT id, name FROM clients WHERE lower(trim(name)) = lower(?) AND id != ?", v.name, cur.id || 0);
  if (dup) bad(`A client called "${dup.name}" already exists`);
  return v;
}

api.get("/clients", wrap((req) => {
  const rows = all(`SELECT c.*,
      (SELECT COUNT(*) FROM orders o WHERE o.client_id = c.id AND o.status != 'cancelled') orders,
      (SELECT COUNT(*) FROM orders o WHERE o.client_id = c.id AND o.status = 'open') open_orders,
      (SELECT COALESCE(SUM(qty),0) FROM orders o WHERE o.client_id = c.id AND o.status != 'cancelled') bags,
      (SELECT COALESCE(SUM(qty * rate),0) FROM orders o WHERE o.client_id = c.id AND o.status != 'cancelled') value,
      (SELECT MAX(order_date) FROM orders o WHERE o.client_id = c.id) last_order
    FROM clients c ORDER BY c.active DESC, c.name`);
  return can(req.user, "money") ? rows : rows.map((r) => ({ ...r, value: null }));
}));

api.get("/clients/:id", wrap((req) => {
  const c = one("SELECT * FROM clients WHERE id=?", req.params.id) || notFound("Client");
  const orders = enrich(all(`${ORDER_SQL} WHERE o.client_id = ? ORDER BY o.order_date DESC`, c.id)).map((o) => hideMoney(req, o));
  return { ...c, orders };
}));

api.post("/clients", need("orders"), wrap((req) => {
  const v = clientFields(req.body);
  const id = run("INSERT INTO clients (name, address, city, phone, agent, gstin) VALUES (?,?,?,?,?,?)", v.name, v.address, v.city, v.phone, v.agent, v.gstin).lastInsertRowid;
  log("order", `New client registered: ${v.name}${v.city ? `, ${v.city}` : ""}`);
  return { id: Number(id) };
}));
api.post("/clients/:id", need("orders"), wrap((req) => {
  const c = one("SELECT * FROM clients WHERE id=?", req.params.id) || notFound("Client");
  const v = clientFields(req.body, c);
  const active = activeFlag(req.body.active, c.active);
  run("UPDATE clients SET name=?, address=?, city=?, phone=?, agent=?, gstin=?, active=? WHERE id=?", v.name, v.address, v.city, v.phone, v.agent, v.gstin, active, c.id);
  log("order", `Client ${active !== c.active ? (active ? "reactivated" : "deactivated") : "updated"}: ${v.name}`);
  return { ok: true };
}));

api.post("/vendors", need("settings"), wrap((req) => {
  const id = run("INSERT INTO vendors (name, city, phone) VALUES (?,?,?)", str(req.body.name, "Name"), req.body.city || null, req.body.phone || null).lastInsertRowid;
  log("settings", `Supplier added: ${req.body.name}`);
  return { id };
}));
api.post("/vendors/:id", need("settings"), wrap((req) => {
  const v = one("SELECT * FROM vendors WHERE id=?", req.params.id) || notFound("Supplier");
  const b = req.body;
  run("UPDATE vendors SET name=?, city=?, phone=?, active=? WHERE id=?", str(b.name ?? v.name, "Name"), b.city ?? v.city, b.phone ?? v.phone, activeFlag(b.active, v.active), v.id);
  log("settings", `Supplier updated: ${b.name ?? v.name}`);
  return { ok: true };
}));

function machineFields(b, cur = {}) {
  const kind = cur.kind || b.kind;
  const optInt = (v, name) => (v === "" || v == null ? null : num(v, name, { min: 1, int: true }));
  const cylinders = b.cylinders ?? cur.cylinders ?? "";
  if (cylinders && !/^\s*\d+(\.\d+)?(\s*,\s*\d+(\.\d+)?)*\s*$/.test(cylinders)) bad("Cylinders: list sizes in inches separated by commas, e.g. 8, 10, 12");
  const types = String(b.bag_types ?? cur.bag_types ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  if (types.some((t) => !BAG_TYPES[t])) bad("Unknown bag type");
  return {
    name: str(b.name ?? cur.name, "Name"),
    per_day: optInt(b.per_day ?? cur.per_day, "Rolls per day"),
    colours: kind === "printing" ? optInt(b.colours ?? cur.colours, "Colours") : null,
    cylinders: kind === "printing" ? cylinders.replace(/\s+/g, "") || null : null,
    bag_types: kind === "cutting" ? types.join(",") || null : null,
  };
}
api.post("/machines", need("settings"), wrap((req) => {
  if (!["printing", "cutting"].includes(req.body.kind)) bad("Choose printing or cutting");
  const f = machineFields(req.body);
  const id = run("INSERT INTO machines (name, kind, per_day, colours, cylinders, bag_types) VALUES (?,?,?,?,?,?)", f.name, req.body.kind, f.per_day, f.colours, f.cylinders, f.bag_types).lastInsertRowid;
  log("settings", `Machine added: ${f.name}`);
  return { id };
}));
api.post("/machines/:id", need("settings"), wrap((req) => {
  const m = one("SELECT * FROM machines WHERE id=?", req.params.id) || notFound("Machine");
  const b = req.body, f = machineFields(b, m);
  run("UPDATE machines SET name=?, per_day=?, colours=?, cylinders=?, bag_types=?, active=? WHERE id=?", f.name, f.per_day, f.colours, f.cylinders, f.bag_types, activeFlag(b.active, m.active), m.id);
  log("settings", `Machine updated: ${f.name}${b.active === false && m.active ? " (retired)" : b.active === true && !m.active ? " (back in use)" : ""}`);
  return { ok: true };
}));

/** Handle stock: a delivery adds to it, a physical count overwrites it, cutting loop/box bags takes from it. */
api.post("/loops", need("settings"), wrap((req) => {
  const color = str(req.body.color, "Colour");
  if (one("SELECT id FROM loops WHERE color = ?", color)) bad("That colour already exists");
  run("INSERT INTO loops (color, balance_kg, min_kg) VALUES (?,?,?)", color, num(req.body.balance_kg ?? 0, "Stock"), num(req.body.min_kg ?? 0, "Minimum"));
  log("stock", `Handle colour added: ${color}`);
  return { ok: true };
}));
api.post("/loops/:id/receive", need("stock"), wrap((req) => {
  const l = one("SELECT * FROM loops WHERE id=?", req.params.id) || notFound("Handle colour");
  const kgIn = num(req.body.kg, "Weight received", { min: 0.1 });
  run("UPDATE loops SET balance_kg = balance_kg + ? WHERE id=?", kgIn, l.id);
  log("stock", `${kgIn} kg ${l.color} handles received`);
  return { ok: true };
}));
api.post("/loops/:id", need("settings"), wrap((req) => {
  const l = one("SELECT * FROM loops WHERE id=?", req.params.id) || notFound("Handle colour");
  const balance = num(req.body.balance_kg, "Balance"), min = num(req.body.min_kg, "Minimum");
  run("UPDATE loops SET balance_kg=?, min_kg=? WHERE id=?", balance, min, l.id);
  if (balance !== l.balance_kg) log("stock", `${l.color} handle stock corrected from ${l.balance_kg} to ${balance} kg after a count`);
  return { ok: true };
}));

api.post("/limits", need("settings"), wrap((req) => {
  const b = req.body;
  run(`INSERT INTO roll_limits (color, size_in, gsm, quality, min_kg) VALUES (?,?,?,?,?)
       ON CONFLICT (color, size_in, gsm, quality) DO UPDATE SET min_kg = excluded.min_kg`,
    str(b.color, "Colour"), num(b.size_in, "Width", { min: 1 }), num(b.gsm, "GSM", { min: 1, int: true }), b.quality || "Standard", num(b.min_kg, "Minimum"));
  log("settings", `Fabric minimum set: ${b.color} ${b.size_in}″ ${b.gsm} GSM → ${b.min_kg} kg`);
  return { ok: true };
}));
api.post("/limits/:id/delete", need("settings"), wrap((req) => {
  const l = one("SELECT * FROM roll_limits WHERE id=?", req.params.id) || notFound("Minimum");
  run("DELETE FROM roll_limits WHERE id=?", l.id);
  log("settings", `Fabric minimum removed: ${l.color} ${l.size_in}″ ${l.gsm} GSM`);
  return { ok: true };
}));
