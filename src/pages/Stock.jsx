import { useState } from "react";
import { Link } from "react-router-dom";
import { api, useData, useAction, useUndo, PageHead, Card, Loading, ErrorBox, Dialog, Field, Segmented, n, kg, dateShort } from "../ui.jsx";
import { useAuth } from "../auth.jsx";
import { Swatch } from "../charts.jsx";

function RollForm({ f, set, meta, purchase }) {
  return (
    <>
      <Field label="Supplier"><select className="input" required value={f.vendor_id || ""} onChange={set("vendor_id")}>
        <option value="" disabled>Choose…</option>{meta?.vendors.filter((v) => v.active || v.id === f.vendor_id).map((v) => <option key={v.id} value={v.id}>{v.name} · {v.city}</option>)}</select></Field>
      <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
        <Field label="Colour"><input className="input" list="colors2" required value={f.color || ""} onChange={set("color")} /><datalist id="colors2">{meta?.colors.map((c) => <option key={c} value={c} />)}</datalist></Field>
        <Field label="Width (in)"><input className="input" type="number" step="0.5" required value={f.size_in || ""} onChange={set("size_in")} /></Field>
        <Field label="GSM"><input className="input" type="number" required value={f.gsm || ""} onChange={set("gsm")} /></Field>
        <Field label="Quality"><select className="input" value={f.quality} onChange={set("quality")}><option>Standard</option><option>Premium</option></select></Field>
        {purchase && <Field label="Rolls"><input className="input" type="number" min="1" max="200" required value={f.count} onChange={set("count")} /></Field>}
        <Field label="Expected on"><input className="input" type="date" value={f.expected_on || ""} onChange={set("expected_on")} /></Field>
        <Field label="Length / roll (m)"><input className="input" type="number" required value={f.length_m} onChange={set("length_m")} /></Field>
        <Field label="Weight / roll (kg)" hint={purchase ? "Correct each roll's actual weight after it arrives" : undefined}><input className="input" type="number" step="0.1" required value={f.net_kg || ""} onChange={set("net_kg")} /></Field>
      </div>
    </>
  );
}

function RollDialog({ roll, meta, onClose, done }) {
  const act = useAction();
  const purchase = !roll.id;
  const [f, setF] = useState(purchase ? { count: 4, quality: "Standard", length_m: 1000 } : { ...roll });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => act.run(() => api(purchase ? "/rolls/purchase" : `/rolls/${roll.id}/edit`, f), purchase ? `${f.count} rolls added as incoming` : `${roll.roll_no} updated`)
    .then((r) => { if (r) { onClose(); done(); } });
  return (
    <Dialog open title={purchase ? "Fabric ordered from supplier" : `Edit ${roll.roll_no}`} onClose={onClose} onSubmit={save} submitLabel={purchase ? "Add incoming rolls" : "Save"} busy={act.busy}>
      <RollForm f={f} set={set} meta={meta} purchase={purchase} />
      {!purchase && roll.order_no && <div className="muted" style={{ fontSize: 12.5 }}>Booked to {roll.order_no}: colour, width, GSM and quality can't change until it's released.</div>}
      {act.error && <ErrorBox error={act.error} />}
    </Dialog>
  );
}

function Handles({ loops, reload }) {
  const { can } = useAuth();
  const act = useAction();
  const [dlg, setDlg] = useState(null); // { mode: 'receive'|'count', l, kg }
  const save = () => dlg.mode === "receive"
    ? act.run(() => api(`/loops/${dlg.l.id}/receive`, { kg: dlg.kg }), "Handles added to stock").then((r) => { if (r) { setDlg(null); reload(); } })
    : act.run(() => api(`/loops/${dlg.l.id}`, { balance_kg: dlg.kg, min_kg: dlg.l.min_kg }), "Handle count corrected").then((r) => { if (r) { setDlg(null); reload(); } });
  return (
    <Card title="Handles" sub="Goes up when a delivery is recorded, down automatically when loop or box bags are cut" pad={false}>
      <table className="tbl"><thead><tr><th>Colour</th><th className="num">In stock</th><th className="num">Minimum</th><th /></tr></thead>
        <tbody>{loops.map((l) => (
          <tr key={l.id}>
            <td><Swatch color={l.color} /> {l.color}</td>
            <td className="num" style={{ color: l.balance_kg < l.min_kg ? "var(--critical)" : undefined, fontWeight: 600 }}>{kg(l.balance_kg)}</td>
            <td className="num dim">{kg(l.min_kg)}</td>
            <td className="num" style={{ whiteSpace: "nowrap" }}>
              {can("stock") && <button className="btn small" onClick={() => setDlg({ mode: "receive", l, kg: "" })}>Delivery received</button>}{" "}
              {can("settings") && <button className="btn small" onClick={() => setDlg({ mode: "count", l, kg: l.balance_kg })}>Correct after count</button>}
            </td>
          </tr>))}
        </tbody></table>
      <Dialog open={!!dlg} title={dlg ? (dlg.mode === "receive" ? `${dlg.l.color} handles received` : `Correct ${dlg.l.color} handle stock`) : ""} onClose={() => { setDlg(null); act.setError(null); }} onSubmit={save} busy={act.busy}>
        {dlg && <>
          <Field label={dlg.mode === "receive" ? "Weight received (kg)" : "Actual stock after counting (kg)"} hint={dlg.mode === "receive" ? `Added to the current ${kg(dlg.l.balance_kg)}` : `System currently shows ${kg(dlg.l.balance_kg)}`}>
            <input className="input" type="number" step="0.1" min="0" required autoFocus value={dlg.kg} onChange={(e) => setDlg({ ...dlg, kg: e.target.value })} />
          </Field>
          {act.error && <ErrorBox error={act.error} />}
        </>}
      </Dialog>
    </Card>
  );
}

export default function Stock() {
  const [view, setView] = useState("stock");
  const { data: rolls, error, reload } = useData(`/rolls?view=${view}`);
  const { data: transit, reload: reloadT } = useData("/rolls?view=transit");
  const { data: meta, reload: reloadM } = useData("/meta");
  const act = useAction();
  const [inSel, setInSel] = useState([]);
  const [stSel, setStSel] = useState([]);
  const [dialog, setDialog] = useState(null); // {} for purchase, roll for edit
  const { can } = useAuth();
  const refresh = () => { reload(); reloadT(); reloadM(); setInSel([]); setStSel([]); };
  const undo = useUndo(refresh);
  const receive = () => act.run(() => api("/rolls/receive", { ids: inSel }), (r) => `${r.received} rolls received into stock`).then((r) => r && refresh());
  const toggle = (setter) => (id) => setter((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="stack">
      <PageHead eyebrow="Fabric & stock" title={<>Rolls & <em>fabric</em></>} actions={can("stock") && <button className="btn primary" onClick={() => setDialog({})}>Fabric ordered</button>}>
        Record a purchase when fabric is ordered, receive it when the truck arrives, and correct each roll's weight from the supplier's slip. Every step can be undone.
      </PageHead>
      {(act.error || undo.error) && <ErrorBox error={act.error || undo.error} />}

      <Card title="Incoming" sub={transit ? `${transit.length} rolls ordered, not yet received` : ""} pad={false}
        action={can("stock") && inSel.length > 0 && <div className="row">
          <button className="btn small" onClick={() => undo.run({ title: `Remove ${inSel.length} incoming roll${inSel.length > 1 ? "s" : ""}?`, body: "Use this if they were entered by mistake or the supplier cancelled.", confirmLabel: "Remove", done: "Incoming rolls removed" }, "/rolls/cancel-incoming", { ids: inSel })}>Remove</button>
          <button className="btn small primary" disabled={act.busy} onClick={receive}>Mark {inSel.length} received</button>
        </div>}>
        {!transit ? <Loading /> : transit.length === 0 ? <div className="empty">Nothing on the way.</div> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr>{can("stock") && <th style={{ width: 36 }}><input type="checkbox" className="check" aria-label="Select all" checked={inSel.length === transit.length} onChange={(e) => setInSel(e.target.checked ? transit.map((r) => r.id) : [])} /></th>}
              <th>Roll</th><th>Supplier</th><th>Fabric</th><th className="num">Weight</th><th>Ordered</th><th>Expected</th><th /></tr></thead>
            <tbody>{transit.map((r) => (
              <tr key={r.id}>
                {can("stock") && <td><input type="checkbox" className="check" aria-label={`Select ${r.roll_no}`} checked={inSel.includes(r.id)} onChange={() => toggle(setInSel)(r.id)} /></td>}
                <td className="mono">{r.roll_no}</td><td>{r.vendor}</td><td><Swatch color={r.color} /> {r.color} · {r.size_in}″ · {r.gsm} GSM · {r.quality}</td>
                <td className="num">{kg(r.net_kg)}</td><td>{dateShort(r.purchased_on)}</td><td>{dateShort(r.expected_on)}</td>
                <td className="num">{can("stock") && <button className="btn small" onClick={() => setDialog(r)}>Edit</button>}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>

      <div>
        <div className="spread wrap" style={{ marginBottom: 12 }}>
          <Segmented value={view} onChange={(v) => { setView(v); setStSel([]); }} options={[
            { value: "stock", label: "Free stock" }, { value: "booked", label: "Booked to orders" }, { value: "used", label: "Used (cut)" },
          ]} />
          {view === "stock" && can("stock") && stSel.length > 0 && (
            <button className="btn small" onClick={() => undo.run({ title: `Mark ${stSel.length} roll${stSel.length > 1 ? "s" : ""} as not received?`, body: "They move back to Incoming. Use this if they were received by mistake.", confirmLabel: "Mark not received", done: "Moved back to incoming" }, "/rolls/unreceive", { ids: stSel })}>Mark {stSel.length} not received</button>
          )}
        </div>
        <Card pad={false}>
          {error ? <ErrorBox error={error} /> : !rolls ? <Loading /> : rolls.length === 0 ? <div className="empty">No rolls.</div> : (
            <div className="tbl-wrap" style={{ maxHeight: 520 }}><table className="tbl">
              <thead><tr>
                {view === "stock" && can("stock") && <th style={{ width: 36 }} />}
                <th>Roll</th><th>Fabric</th><th className="num">Weight</th><th className="num">Length</th>
                {view === "stock" && <th>Received</th>}
                {view !== "stock" && <th>Order</th>}
                {view === "booked" && <th>Printed</th>}
                {view === "used" && <><th>Cut</th><th className="num">Bags</th><th className="num">Waste</th></>}
                <th />
              </tr></thead>
              <tbody>{rolls.map((r) => (
                <tr key={r.id}>
                  {view === "stock" && can("stock") && <td><input type="checkbox" className="check" aria-label={`Select ${r.roll_no}`} checked={stSel.includes(r.id)} onChange={() => toggle(setStSel)(r.id)} /></td>}
                  <td className="mono">{r.roll_no}</td>
                  <td><Swatch color={r.color} /> {r.color} · {r.size_in}″ · {r.gsm} · {r.quality}</td>
                  <td className="num">{kg(r.net_kg)}</td><td className="num">{n(r.length_m)} m</td>
                  {view === "stock" && <td>{dateShort(r.received_on)}</td>}
                  {view !== "stock" && <td><Link className="card-link" to={`/orders/${r.order_id}`}>{r.order_no}</Link></td>}
                  {view === "booked" && <td>{r.printed_on ? dateShort(r.printed_on) : <span className="dim">—</span>}</td>}
                  {view === "used" && <><td>{dateShort(r.cut_on)}</td><td className="num">{n(r.bags_out)}</td><td className="num">{r.waste_kg} kg <span className="dim">({((r.waste_kg / r.net_kg) * 100).toFixed(1)}%)</span></td></>}
                  <td className="num">{can("stock") && !r.printed_on && <button className="btn small" onClick={() => setDialog(r)}>Edit</button>}</td>
                </tr>))}
              </tbody>
            </table></div>
          )}
        </Card>
      </div>

      {meta && <Handles loops={meta.loops} reload={reloadM} />}
      {dialog && <RollDialog roll={dialog} meta={meta} onClose={() => setDialog(null)} done={refresh} />}
    </div>
  );
}
