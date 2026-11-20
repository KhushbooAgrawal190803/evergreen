// Demo data: a plausible two-month snapshot of a small bag factory. All names are invented.
import { db, run, one, tx, addDays, today, DB_PATH } from "./db.js";
import { rollSizeRange, bagsFromRoll } from "./formulas.js";
import { pathToFileURL } from "node:url";

let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (a, b) => Math.round(a + rand() * (b - a));

export function seedDemo({ reset = false } = {}) {
  if (reset) {
    for (const t of ["activity", "challan_sacks", "sacks", "challans", "rolls", "orders", "roll_limits", "loops", "machines", "vendors", "clients"]) run(`DELETE FROM ${t}`);
  }
  if (one("SELECT COUNT(*) n FROM orders").n > 0) return false;

  tx(() => {
    const clients = [
      ["Greenleaf Supermart", "Kolkata", "Ravi"], ["Banyan Textiles", "Howrah", "Meena"],
      ["Sunrise Pharmacy Chain", "Durgapur", "Ravi"], ["Mishti Ghar Sweets", "Kolkata", "Arjun"],
      ["Northwind Garments", "Siliguri", "Meena"], ["Lotus Footwear", "Kolkata", "Arjun"],
      ["Hooghly Fresh Mart", "Chinsurah", "Ravi"], ["Indigo Boutique", "Kolkata", "Meena"],
      ["Coastal Electronics", "Haldia", "Arjun"], ["Saffron Kitchenware", "Asansol", "Ravi"],
      ["Bluebell Books", "Kolkata", "Meena"], ["Riverbend Organics", "Kalyani", "Arjun"],
    ];
    clients.forEach(([n, c, a], i) => run("INSERT INTO clients (name, city, phone, agent, address) VALUES (?,?,?,?,?)", n, c, `98${between(10000000, 99999999)}`, a, `${between(2, 220)}, ${["Park Street", "MG Road", "Station Road", "Lake Town", "College Street", "GT Road"][i % 6]}`));
    [["Shakti Nonwovens", "Ahmedabad"], ["Eastern Polyfab", "Kolkata"], ["Vardhman Fabrics", "Surat"]]
      .forEach(([n, c]) => run("INSERT INTO vendors (name, city) VALUES (?,?)", n, c));
    [["Printer 1", 2, 6], ["Printer 2", 4, 4], ["Printer 3", 1, 6]].forEach(([n, c, d]) => run("INSERT INTO machines (name, kind, colours, per_day) VALUES (?, 'printing', ?, ?)", n, c, d));
    [["Cutter A", "dcut", 4], ["Cutter B", "loop", 3], ["Cutter C", "box", 2], ["Cutter D", "ucut", 4]].forEach(([n, t, d]) => run("INSERT INTO machines (name, kind, bag_types, per_day) VALUES (?, 'cutting', ?, ?)", n, t, d));
    for (const [k, v] of [["name", "Evergreen Bag Works"], ["address", "Factory address — to be confirmed"], ["gstin", ""], ["phone", ""], ["hsn", ""]])
      run("INSERT OR REPLACE INTO company (key, value) VALUES (?, ?)", k, v);
    [["White", 820, 300], ["Red", 140, 250], ["Green", 330, 250], ["Navy", 610, 200], ["Black", 95, 150]]
      .forEach(([c, b, m]) => run("INSERT INTO loops (color, balance_kg, min_kg) VALUES (?,?,?)", c, b, m));

    // Order templates: [bag_type, w, l, g, gsm, colour, quality]
    const specs = [
      ["dcut", 10, 14, 0, 60, "White", "Premium"], ["dcut", 12, 16, 0, 70, "White", "Premium"],
      ["loop", 13, 15, 0, 80, "Navy", "Premium"], ["box", 14, 16, 4, 90, "Black", "Premium"],
      ["ucut", 9, 13, 0, 50, "Green", "Standard"], ["dcut", 8, 10, 0, 50, "Red", "Standard"],
      ["loop", 12, 14, 0, 70, "Cream", "Standard"], ["ucut", 11, 16, 0, 60, "White", "Standard"],
    ];
    const prints = ["Logo · 1 colour", "Logo · 2 colours", "Full print · 4 colours", "Plain"];
    const printers = [1, 2, 3], cutterFor = { dcut: 4, loop: 5, box: 6, ucut: 7 };
    let rollSeq = 1, sackSeq = 1, orderSeq = 2401, challanSeq = 1;

    const makeRoll = (s, extra = {}) => {
      const [type, w, l, g, gsm, color, quality] = s;
      const size = rollSizeRange(type, { w, l, g })[0];
      const length = between(950, 1100);
      const kg = +((length * 39.37 * size * gsm) / 1550 / 1000).toFixed(1);
      const r = {
        roll_no: `R-${String(rollSeq++).padStart(4, "0")}`, vendor_id: between(1, 3), color, size_in: size, gsm, quality,
        length_m: length, net_kg: kg, status: "stock", purchased_on: addDays(-between(20, 45)),
        expected_on: null, received_on: addDays(-between(5, 18)), order_id: null,
        print_machine_id: null, printed_on: null, print_kg: null, cut_machine_id: null, cut_on: null, bags_out: null, waste_kg: null,
        ...extra,
      };
      const id = run(`INSERT INTO rolls (${Object.keys(r).join(",")}) VALUES (${Object.keys(r).map(() => "?").join(",")})`, ...Object.values(r)).lastInsertRowid;
      return { id, ...r };
    };

    // Orders across every stage. stage: 0 awaiting fabric · 1 booked · 2 printing · 3 cutting/packing · 4 ready · 5 dispatched
    const plan = [
      ...Array(5).fill(0), ...Array(5).fill(1), ...Array(4).fill(2), ...Array(4).fill(3), ...Array(3).fill(4), ...Array(9).fill(5),
    ];
    plan.forEach((stage, i) => {
      const s = pick(specs);
      const [type, w, l, g, gsm, color, quality] = s;
      const client = between(1, clients.length);
      const qty = pick([3000, 5000, 8000, 10000, 15000, 20000]);
      const orderDate = addDays(-between(stage * 4 + 3, stage * 5 + 12));
      let due = stage === 5 ? addDays(-between(1, 12)) : addDays(between(-3, 14));
      if (i === 0 || i === 6) due = addDays(-2);            // a couple genuinely late
      if (i === 7 || i === 15) due = today();               // due today
      const status = stage === 5 ? "delivered" : "open";
      const oid = run(`INSERT INTO orders (order_no, client_id, bag_type, w, l, g, gsm, color, quality, print_colors, loop_color, qty, rate, order_date, due_date, status, delivered_on)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        `EG-${orderSeq++}`, client, type, w, l, g, gsm, color, quality, pick(prints),
        type === "loop" || type === "box" ? pick(["White", "Navy", "Black", "Red"]) : null,
        qty, +(0.8 + rand() * 2.4).toFixed(2), orderDate, due, status, status === "delivered" ? due : null).lastInsertRowid;
      if (stage === 0) return;

      // Book enough rolls to cover the quantity.
      let covered = 0, rolls = [];
      while (covered < qty) {
        const r = makeRoll(s, { order_id: oid });
        covered += bagsFromRoll(type, { w, l, g }, r); rolls.push(r);
      }
      let cutPieces = 0;
      rolls.forEach((r, k) => {
        const printed = stage >= 3 || (stage === 2 && k < rolls.length / 2);
        const cut = stage >= 4 || (stage === 3 && k < Math.ceil(rolls.length * 0.6));
        if (printed) run("UPDATE rolls SET print_machine_id=?, printed_on=?, print_kg=? WHERE id=?", pick(printers), addDays(-between(2, 6)), +(r.net_kg * 1.01).toFixed(1), r.id);
        if (cut) {
          const bags = Math.floor(bagsFromRoll(type, { w, l, g }, r) * (0.95 + rand() * 0.04));
          const waste = +(r.net_kg * (0.025 + rand() * 0.04)).toFixed(1);
          run("UPDATE rolls SET cut_machine_id=?, cut_on=?, bags_out=?, waste_kg=? WHERE id=?", cutterFor[type], addDays(-between(0, 6)), bags, waste, r.id);
          cutPieces += bags;
        }
      });

      // Pack what was cut into sacks of ~1,000 pieces.
      const toPack = stage >= 4 ? qty : Math.floor(cutPieces * 0.7);
      const status2 = stage === 5 ? "dispatched" : stage === 4 ? pick(["factory", "godown"]) : "factory";
      // Sacks only leave the factory through a challan, so the demo creates the challans that moved them.
      const challan = (kind, date) => run("INSERT INTO challans (challan_no, date, kind, vehicle, destination) VALUES (?,?,?,?,?)",
        `CH-${String(challanSeq++).padStart(4, "0")}`, date, kind, `WB-${between(10, 99)}-${between(1000, 9999)}`, kind === "To client" ? "Client" : "Godown").lastInsertRowid;
      const challanId = status2 === "dispatched" ? challan("To client", due) : status2 === "godown" ? challan("Factory → Godown", addDays(-1)) : null;
      for (let left = toPack; left > 0; left -= 1000) {
        const pcs = Math.min(1000, left);
        const sackNo = `S-${String(sackSeq++).padStart(5, "0")}`, sackKg = +(pcs * 0.012 + 0.4).toFixed(1);
        const sid = run("INSERT INTO sacks (sack_no, order_id, pieces, kg, status, packed_on, challan_id, prev_status) VALUES (?,?,?,?,?,?,?,?)",
          sackNo, oid, pcs, sackKg, status2, addDays(-between(0, 3)), challanId, challanId ? "factory" : null).lastInsertRowid;
        if (challanId) run("INSERT INTO challan_sacks (challan_id, sack_id, order_id, sack_no, pieces, kg) VALUES (?,?,?,?,?,?)", challanId, sid, oid, sackNo, pcs, sackKg);
      }
    });

    // Free stock (not booked) and shipments on the way.
    for (const s of specs) for (let k = 0; k < between(1, 5); k++) makeRoll(s);
    makeRoll(specs[0], { status: "transit", received_on: null, expected_on: addDays(2), purchased_on: addDays(-4) });
    makeRoll(specs[0], { status: "transit", received_on: null, expected_on: addDays(2), purchased_on: addDays(-4) });
    makeRoll(specs[4], { status: "transit", received_on: null, expected_on: addDays(5), purchased_on: addDays(-2) });
    makeRoll(specs[3], { status: "transit", received_on: null, expected_on: addDays(1), purchased_on: addDays(-6) });

    // Minimum-stock rules for each fabric type in use.
    for (const s of specs) {
      const [type, w, l, g, gsm, color, quality] = s;
      const size = rollSizeRange(type, { w, l, g })[0];
      run("INSERT OR IGNORE INTO roll_limits (color, size_in, gsm, quality, min_kg) VALUES (?,?,?,?,?)", color, size, gsm, quality, pick([60, 90, 120, 180]));
    }

    const acts = [
      ["order", "New order EG-2405 from Banyan Textiles · 5,000 U-Cut"], ["print", "R-0031 printed on Printer 2"],
      ["cut", "R-0024 cut on Cutter D · 3,140 bags"], ["pack", "6 sacks packed for EG-2416"],
      ["ship", "Challan CH-0009 · 8 sacks to Bluebell Books"], ["stock", "4 rolls received from Shakti Nonwovens"],
    ];
    acts.forEach(([k, t], i) => run("INSERT INTO activity (kind, text, ts) VALUES (?,?, datetime('now','localtime', ?))", k, t, `-${(acts.length - i) * 47} minutes`));
  });
  return true;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  seedDemo({ reset: process.argv.includes("--reset") });
  console.log("Demo data loaded into", DB_PATH);
}
