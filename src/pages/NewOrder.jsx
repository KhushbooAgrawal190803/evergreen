import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import ClientDialog from "../ClientDialog.jsx";
import { api, useData, useAction, PageHead, Card, Field, ErrorBox, n } from "../ui.jsx";

const TYPE_HINT = { dcut: "Punched handle", loop: "Stitched loop handle", box: "With side gusset", ucut: "Vest-style" };
const inDays = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toLocaleDateString("en-CA"); };

export default function NewOrder() {
  const { data: meta, reload: reloadMeta } = useData("/meta");
  const [params] = useSearchParams();
  const [newClient, setNewClient] = useState(false);
  const nav = useNavigate();
  const { run, busy, error } = useAction();
  const [f, setF] = useState({ client_id: params.get("client") || "", bag_type: "dcut", quality: "Standard", due_date: inDays(10), qty: 5000, gsm: 60, color: "White", print_colors: "Logo · 1 colour" });
  const [preview, setPreview] = useState(null);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target ? e.target.value : e }));

  useEffect(() => {
    const t = setTimeout(() => api("/orders/preview", f).then(setPreview).catch(() => setPreview(null)), 150);
    return () => clearTimeout(t);
  }, [f.bag_type, f.w, f.l, f.g, f.gsm, f.qty]);

  const submit = async (e) => {
    e.preventDefault();
    const r = await run(() => api("/orders", f), (r) => `Order ${r.order_no} created`);
    if (r) nav(`/orders/${r.id}`);
  };

  return (
    <form onSubmit={submit}>
      <PageHead eyebrow="Orders" title={<>New <em>order</em></>}>Fill in what the client asked for. Fabric, cylinder and weight are worked out as you type.</PageHead>
      <div className="grid g-2" style={{ alignItems: "start" }}>
        <div className="stack">
          <Card title="Client">
            <div className="form-grid">
              <Field label="Client" className="span2">
                <select className="input" required value={f.client_id || ""} onChange={(e) => e.target.value === "__new" ? setNewClient(true) : set("client_id")(e)}>
                  <option value="" disabled>Choose a client…</option>
                  {meta?.clients.filter((c) => c.active).map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` · ${c.city}` : ""}</option>)}
                  <option value="__new">+ Register a new client…</option>
                </select>
              </Field>
              <Field label="Delivery date"><input type="date" className="input" required min={inDays(0)} value={f.due_date} onChange={set("due_date")} /></Field>
              <Field label="Rate per bag (₹)"><input type="number" step="0.01" min="0" className="input" value={f.rate || ""} onChange={set("rate")} /></Field>
            </div>
          </Card>
          <Card title="Bag">
            <div className="stack" style={{ gap: 18 }}>
              <div className="choice">
                {meta?.bagTypes.map((t) => (
                  <button type="button" key={t.key} className={f.bag_type === t.key ? "on" : ""} onClick={() => set("bag_type")(t.key)}>
                    <b>{t.name}</b><span>{TYPE_HINT[t.key]}</span>
                  </button>
                ))}
              </div>
              <div className="form-grid">
                <Field label="Width (in)"><input type="number" step="0.5" min="1" required className="input" value={f.w || ""} onChange={set("w")} /></Field>
                <Field label="Height (in)"><input type="number" step="0.5" min="1" required className="input" value={f.l || ""} onChange={set("l")} /></Field>
                <Field label="Gusset (in)"><input type="number" step="0.5" min="0" className="input" disabled={f.bag_type !== "box"} required={f.bag_type === "box"} value={f.bag_type === "box" ? f.g || "" : ""} onChange={set("g")} /></Field>
                <Field label="Quantity (pieces)"><input type="number" min="1" step="100" required className="input" value={f.qty} onChange={set("qty")} /></Field>
                <Field label="Fabric colour">
                  <input className="input" list="colors" required value={f.color} onChange={set("color")} />
                  <datalist id="colors">{meta?.colors.map((c) => <option key={c} value={c} />)}</datalist>
                </Field>
                <Field label="GSM" hint="Fabric thickness"><input type="number" min="20" required className="input" value={f.gsm} onChange={set("gsm")} /></Field>
                <Field label="Quality">
                  <select className="input" value={f.quality} onChange={set("quality")}><option>Standard</option><option>Premium</option></select>
                </Field>
                <Field label="Handle colour">
                  <select className="input" disabled={!["loop", "box"].includes(f.bag_type)} value={f.loop_color || ""} onChange={set("loop_color")}>
                    <option value="">—</option>{meta?.loops.map((l) => <option key={l.id}>{l.color}</option>)}
                  </select>
                </Field>
                <Field label="Printing" className="span2"><input className="input" value={f.print_colors} onChange={set("print_colors")} /></Field>
                <Field label="Notes" className="span2"><input className="input" value={f.notes || ""} onChange={set("notes")} /></Field>
              </div>
            </div>
          </Card>
        </div>
        <div className="stack" style={{ position: "sticky", top: 24 }}>
          <Card title="What this needs" sub="From the client's production formulas">
            <div className="calc">
              <div className="calc-row"><span>Roll width</span><b>{preview ? `${preview.rollSize[0]}–${preview.rollSize[1]}″` : "—"}</b></div>
              <div className="calc-row"><span>Printing cylinder</span><b>{preview ? `${preview.cylinder}″` : "—"}</b></div>
              <div className="calc-row"><span>Weight per bag</span><b>{preview?.bagWeightG ? `${preview.bagWeightG} g` : "—"}</b></div>
              <div className="calc-row"><span>Fabric for the order</span><b>{preview?.fabricKg ? `${n(preview.fabricKg)} kg` : "—"}</b></div>
            </div>
          </Card>
          {error && <ErrorBox error={error} />}
          <button className="btn primary" disabled={busy} style={{ justifyContent: "center", padding: "12px" }}>{busy ? "Saving…" : "Create order"}</button>
        </div>
      </div>
      {newClient && <ClientDialog onClose={() => setNewClient(false)} onSaved={(id) => { setNewClient(false); reloadMeta(); setF((s) => ({ ...s, client_id: String(id) })); }} />}
    </form>
  );
}
