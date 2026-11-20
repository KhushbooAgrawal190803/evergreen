const B = "http://localhost:5173/api";
let cookie = "";
const call = async (p, body) => {
  const r = await fetch(B + p, { method: body === undefined ? "GET" : "POST", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const ok = async (p, b) => { const r = await call(p, b); if (r.s !== 200) throw new Error(`${p} → ${r.s} ${r.j.error}`); return r.j; };
let fails = 0;
const t = (name, pass, x = "") => { if (!pass) fails++; console.log(`${pass ? "PASS" : "FAIL"}  ${name}${x ? "  → " + x : ""}`); };

const me = (await ok("/auth/login", { email: "owner@evergreen.test", password: "evergreen-demo" })).user;
t("owner is Nikunj Poddar", me.name === "Nikunj Poddar");

const p = await ok("/production");
const byId = Object.fromEntries(p.machines.map((m) => [m.id, m]));
const printOk = p.toPrint.every((r) => { const s = r.suggest.print; return s.problem || (byId[s.machine_id].colours ?? 99) >= r.colours; });
t("every print suggestion has enough colours", printOk);
const cutOk = [...p.toPrint, ...p.toCut].every((r) => { const s = r.suggest.cut; return !s || s.problem || !byId[s.machine_id].bag_types || byId[s.machine_id].bag_types.split(",").includes(r.bag_type); });
t("every cut suggestion matches the bag type", cutOk);
const fourColour = p.toPrint.find((r) => r.colours === 4);
if (fourColour) t("4-colour job goes to the 4-colour printer", byId[fourColour.suggest.print.machine_id].colours === 4, `${fourColour.roll_no} → ${fourColour.suggest.print.machine}`);
const urgentFirst = p.toPrint.filter((r) => !r.suggest.print.problem);
t("earliest-due rolls get the earliest slots", urgentFirst.length < 2 || urgentFirst[0].suggest.print.day <= urgentFirst[urgentFirst.length - 1].suggest.print.day);
const cutAfterPrint = p.toPrint.every((r) => r.suggest.cut.problem || r.suggest.cut.day > r.suggest.print.day);
t("cutting is scheduled after printing", cutAfterPrint);
console.log(`      queues: print ${p.summary.printDays} days, cut ${p.summary.cutDays} days · at risk: ${p.summary.atRisk.map((o) => `${o.order_no}+${o.days_over}d`).join(", ") || "none"}`);

// Refuse an incapable machine
if (fourColour) {
  const onePrinter = p.machines.find((m) => m.kind === "printing" && m.colours === 1);
  const r = await call(`/rolls/${fourColour.id}/print`, { machine_id: onePrinter.id });
  t("refuse: 4-colour job on a 1-colour printer", r.s === 400, r.j.error);
}
const someCut = p.toCut[0];
if (someCut) {
  const wrong = p.machines.find((m) => m.kind === "cutting" && m.bag_types && !m.bag_types.split(",").includes(someCut.bag_type));
  const r = await call(`/rolls/${someCut.id}/cut`, { machine_id: wrong.id, bags_out: 100, waste_kg: 1 });
  t("refuse: cutting on a machine that doesn't make that bag", r.s === 400, r.j.error);
}

// Add a cylinder list that excludes a job → it becomes unschedulable on that printer
const p2 = p.machines.find((m) => m.name === "Printer 2");
await ok(`/machines/${p2.id}`, { cylinders: "99" });
const after = await ok("/production");
const fc = fourColour && after.toPrint.find((r) => r.id === fourColour.id);
if (fc) t("no matching cylinder → 'can't schedule' with the reason", !!fc.suggest.print.problem, fc.suggest.print.problem);
await ok(`/machines/${p2.id}`, { cylinders: "" });

// Challan document
const sk = await ok("/sacks");
const godown = sk.groups.find((g) => g.status === "factory");
const made = await ok("/sacks/move", { ids: godown.sacks, to: "godown", vehicle: "WB-02-1234" });
const doc = await ok(`/challans/${made.id}`);
t("challan lists the goods", doc.items.length === 1 && doc.items[0].pieces === godown.pieces, doc.items[0]?.description);
t("challan has company header", !!doc.company.name, doc.company.name);
await ok(`/challans/${made.id}/cancel`, { reason: "test" });
const doc2 = await ok(`/challans/${made.id}`);
t("cancelled challan keeps its contents for the record", doc2.items.length === 1 && !!doc2.challan.cancelled_on);
const d = await ok("/dashboard");
t("dashboard carries forecast risk", Array.isArray(d.atRisk));
console.log(`\n${fails ? fails + " FAILED" : "All passed"}`);
process.exit(fails ? 1 : 0);
