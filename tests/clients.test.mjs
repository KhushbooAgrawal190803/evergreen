const B = "http://localhost:5173/api";
const session = () => {
  let cookie = "";
  return async (p, body) => {
    const r = await fetch(B + p, { method: body === undefined ? "GET" : "POST", headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
    return { s: r.status, j: await r.json().catch(() => ({})) };
  };
};
let fails = 0;
const t = (name, pass, x = "") => { if (!pass) fails++; console.log(`${pass ? "PASS" : "FAIL"}  ${name}${x ? "  → " + x : ""}`); };

const mgr = session();
await mgr("/auth/login", { email: "manager@evergreen.test", password: "evergreen-demo" });
let r = await mgr("/clients", { name: "Bengal Organic Foods", address: "12 Salt Lake Sector V", city: "Kolkata", phone: "98300 12345", gstin: "19abcde1234f1z5", agent: "Meena" });
t("manager registers a new client", r.s === 200);
const id = r.j.id;
r = await mgr("/clients", { name: "bengal organic foods " });
t("refuse duplicate name (case/space-insensitive)", r.s === 400, r.j.error);
r = await mgr("/clients", { name: "Someone Else", gstin: "12345" });
t("refuse malformed GSTIN", r.s === 400, r.j.error);
r = await mgr("/clients", { name: "" });
t("refuse empty name", r.s === 400, r.j.error);
const list = (await mgr("/clients")).j;
const mine = list.find((c) => c.id === id);
t("appears in client list with GSTIN upper-cased", mine?.gstin === "19ABCDE1234F1Z5");
const due = new Date(Date.now() + 7 * 864e5).toLocaleDateString("en-CA");
r = await mgr("/orders", { bag_type: "dcut", client_id: id, w: 10, l: 14, gsm: 60, qty: 5000, color: "White", quality: "Standard", due_date: due, rate: 1.2 });
t("take an order for the new client", r.s === 200, r.j.order_no);
const detail = (await mgr(`/clients/${id}`)).j;
t("client page shows that order", detail.orders.length === 1 && detail.orders[0].stage === "fabric");
r = await mgr(`/clients/${id}`, { active: false });
t("deactivate client", r.s === 200);
r = await mgr("/orders", { bag_type: "dcut", client_id: id, w: 10, l: 14, gsm: 60, qty: 100, color: "White", due_date: due });
t("refuse new orders for an inactive client", r.s === 400, r.j.error);
await mgr(`/clients/${id}`, { active: true });

const floor = session();
await floor("/auth/login", { email: "floor@evergreen.test", password: "evergreen-demo" });
r = await floor("/clients", { name: "Should Not Work" });
t("floor operator can't register clients", r.s === 403);
const fl = (await floor("/clients")).j;
t("floor operator sees no money values", fl.every((c) => c.value === null));
const log = (await (async () => { const o = session(); await o("/auth/login", { email: "owner@evergreen.test", password: "evergreen-demo" }); return (await o("/activity")).j; })());
t("registration is in the activity log with who did it", log.some((a) => a.text.startsWith("New client registered: Bengal Organic Foods") && a.user === "Rohan Das"));
console.log(`\n${fails ? fails + " FAILED" : "All passed"}`);
process.exit(fails ? 1 : 0);
