import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, useData, useAction, useUndo, PageHead, Card, Loading, ErrorBox, Dialog, Field, StagePill, n, kg, dateShort, dueText } from "../ui.jsx";
import { useAuth } from "../auth.jsx";

const STEPS = ["Awaiting fabric", "Printing", "Cutting", "Packing", "Ready to ship", "Delivered"];
const WHERE = { factory: ["", "At factory"], godown: ["info", "In godown"], dispatched: ["ok", "Sent to client"] };

function Steps({ o }) {
  const p = o.progress;
  const sub = [
    `${n(p.bookedPieces)} / ${n(o.qty)} bags of fabric`,
    `${p.printed} / ${p.rolls} rolls printed`,
    `${p.cut} / ${p.rolls} rolls cut`,
    `${n(p.packed)} / ${n(o.qty)} bags packed`,
    `${n(p.inGodown)} in godown`,
    o.delivered_on ? dateShort(o.delivered_on) : `${n(p.dispatched)} sent`,
  ];
  return (
    <div className="steps">
      {STEPS.map((s, i) => (
        <div key={s} className={`step ${i < o.stageIdx || o.stage === "delivered" ? "done" : ""} ${i === o.stageIdx && o.stage !== "delivered" ? "now" : ""} ${o.late ? "late" : ""}`}>
          <b>{s}</b><span>{sub[i]}</span>
        </div>
      ))}
    </div>
  );
}

function EditOrder({ o, meta, onClose, onSaved }) {
  const { can } = useAuth();
  const act = useAction();
  const locked = o.progress.printed > 0;        // bag spec fixed once fabric is printed
  const booked = o.progress.rolls > 0;          // fabric spec fixed while rolls are booked
  const [f, setF] = useState({
    client_id: o.client_id, due_date: o.due_date, qty: o.qty, rate: o.rate ?? "", notes: o.notes || "",
    bag_type: o.bag_type, w: o.w, l: o.l, g: o.g || "", gsm: o.gsm, color: o.color, quality: o.quality, print_colors: o.print_colors || "", loop_color: o.loop_color || "",
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = () => {
    const body = { ...f };
    if (!can("money")) delete body.rate;
    return act.run(() => api(`/orders/${o.id}/edit`, body), "Order updated").then((r) => r && onSaved());
  };
  const specOff = locked || booked;
  return (
    <Dialog open title={`Edit ${o.order_no}`} onClose={onClose} onSubmit={save} busy={act.busy}>
      <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Field label="Client" className="span2">
          <select className="input" value={f.client_id} onChange={set("client_id")}>
            {meta?.clients.filter((c) => c.active || c.id === o.client_id).map((c) => <option key={c.id} value={c.id}>{c.name} · {c.city}</option>)}
          </select>
        </Field>
        <Field label="Delivery date"><input className="input" type="date" required value={f.due_date} onChange={set("due_date")} /></Field>
        <Field label="Quantity (bags)"><input className="input" type="number" min="1" required value={f.qty} onChange={set("qty")} /></Field>
        {can("money") && <Field label="Rate per bag (₹)"><input className="input" type="number" step="0.01" min="0" value={f.rate} onChange={set("rate")} /></Field>}
        <Field label="Printing" hint={locked ? "Locked: already printed" : undefined}><input className="input" disabled={locked} value={f.print_colors} onChange={set("print_colors")} /></Field>
        <Field label="Bag type"><select className="input" disabled={specOff} value={f.bag_type} onChange={set("bag_type")}>{meta?.bagTypes.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></Field>
        <Field label="Handle colour"><select className="input" disabled={locked || !["loop", "box"].includes(f.bag_type)} value={f.loop_color} onChange={set("loop_color")}><option value="">—</option>{meta?.loops.map((l) => <option key={l.id}>{l.color}</option>)}</select></Field>
        <Field label="Width (in)"><input className="input" type="number" step="0.5" disabled={specOff} value={f.w} onChange={set("w")} /></Field>
        <Field label="Height (in)"><input className="input" type="number" step="0.5" disabled={specOff} value={f.l} onChange={set("l")} /></Field>
        <Field label="Gusset (in)"><input className="input" type="number" step="0.5" disabled={specOff || f.bag_type !== "box"} value={f.g} onChange={set("g")} /></Field>
        <Field label="GSM"><input className="input" type="number" disabled={specOff} value={f.gsm} onChange={set("gsm")} /></Field>
        <Field label="Fabric colour"><input className="input" disabled={specOff} value={f.color} onChange={set("color")} /></Field>
        <Field label="Quality"><select className="input" disabled={specOff} value={f.quality} onChange={set("quality")}><option>Standard</option><option>Premium</option></select></Field>
        <Field label="Notes" className="span2"><input className="input" value={f.notes} onChange={set("notes")} /></Field>
      </div>
      {specOff && <div className="muted" style={{ fontSize: 12.5 }}>{locked ? "Fabric is already printed, so the bag and fabric can't change." : "Rolls are booked to this order. Release them to change the bag or fabric."}</div>}
      {act.error && <ErrorBox error={act.error} />}
    </Dialog>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const { data: o, error, reload } = useData(`/orders/${id}`);
  const { data: meta } = useData("/meta");
  const act = useAction();
  const undo = useUndo(reload);
  const [pack, setPack] = useState(null);
  const [editing, setEditing] = useState(false);
  const [sel, setSel] = useState([]);
  const { can } = useAuth();
  if (error) return <ErrorBox error={error} />;
  if (!o) return <Loading />;

  const open = o.status === "open";
  const remaining = Math.max(0, o.qty - o.progress.bookedPieces);
  const toPack = o.progress.cutPieces - o.progress.packed;
  const book = (ids) => act.run(() => api(`/orders/${o.id}/book`, ids ? { roll_ids: ids } : {}), "Rolls booked").then((r) => r && reload());
  const savePack = () => act.run(() => api(`/orders/${o.id}/pack`, pack), "Sacks packed").then((r) => { if (r) { setPack(null); reload(); } });
  const factorySacks = o.sacks.filter((s) => s.status === "factory");

  const actions = (
    <>
      <StagePill o={o} />
      {o.status === "cancelled" && <span className="pill bad plain">Cancelled</span>}
      {can("orders") && open && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
      {can("orders") && open && o.progress.printed === 0 && <button className="btn" onClick={() => undo.run({ title: `Cancel ${o.order_no}?`, body: "Any booked rolls go back to free stock. You can reopen the order later.", confirmLabel: "Cancel order", done: "Order cancelled" }, `/orders/${o.id}/cancel`)}>Cancel order</button>}
      {can("orders") && open && o.progress.dispatched > 0 && <button className="btn" onClick={() => undo.run({ title: "Close as delivered?", body: `${n(o.progress.dispatched)} of ${n(o.qty)} bags have been sent. Use this when the client has accepted a short delivery.`, reason: "Why is it being closed?", confirmLabel: "Close order", done: "Order closed" }, `/orders/${o.id}/close`)}>Close as delivered</button>}
      {can("orders") && !open && <button className="btn" onClick={() => undo.run({ title: `Reopen ${o.order_no}?`, body: "It goes back on the order book as an open order.", confirmLabel: "Reopen", done: "Order reopened" }, `/orders/${o.id}/reopen`)}>Reopen</button>}
      {can("pack") && open && toPack > 0 && <button className="btn primary" onClick={() => setPack({ sacks: Math.max(1, Math.floor(toPack / 1000)), pieces: Math.min(1000, toPack), kg: 12 })}>Pack bags</button>}
    </>
  );

  return (
    <div className="stack">
      <PageHead eyebrow={<Link to="/orders">← Orders</Link>} title={<>{o.order_no} <em>· {o.client}</em></>} actions={actions}>
        {n(o.qty)} {o.bag_type_name} bags, {o.size}″, {o.color} {o.gsm} GSM {o.quality.toLowerCase()} · {o.print_colors || "plain"}.{" "}
        <span className={o.late ? "bad" : ""}>{o.stage === "delivered" ? `Delivered ${dateShort(o.delivered_on)}.` : `${dueText(o.daysLeft)} (${dateShort(o.due_date)}).`}</span>
        {o.close_note && <> Closed early: <i>{o.close_note}</i>.</>}
      </PageHead>

      {(act.error || undo.error) && <ErrorBox error={act.error || undo.error} />}

      <Card><Steps o={o} /></Card>

      <Card>
        <div className="facts">
          <div className="fact"><span>Roll width needed</span><b>{o.rollSize[0]}–{o.rollSize[1]}″</b></div>
          <div className="fact"><span>Printing cylinder</span><b>{o.cylinder}″</b></div>
          <div className="fact"><span>Handle</span><b>{o.loop_color || "—"}</b></div>
          {can("money") && <div className="fact"><span>Rate</span><b>{o.rate ? `₹${o.rate} / bag` : "—"}</b></div>}
          <div className="fact"><span>Ordered</span><b>{dateShort(o.order_date)}</b></div>
          <div className="fact"><span>Agent</span><b>{o.agent || "—"}</b></div>
          <div className="fact"><span>Bags cut so far</span><b>{n(o.progress.cutPieces)}</b></div>
          {o.forecast && <div className="fact"><span>Forecast ready</span>{o.forecast.problem
            ? <b style={{ color: "var(--critical)" }} title={o.forecast.problem}>Can't schedule</b>
            : <b style={{ color: o.forecast.at_risk ? "#a8691b" : "var(--good)" }}>{dateShort(o.forecast.ready_date)}{o.forecast.at_risk ? ` · ${o.forecast.days_over}d late` : " · on time"}</b>}</div>}
          {can("money") && <div className="fact"><span>Order value</span><b>{o.rate ? `₹${n(o.rate * o.qty)}` : "—"}</b></div>}
          {o.notes && <div className="fact" style={{ gridColumn: "1 / -1" }}><span>Notes</span><b>{o.notes}</b></div>}
        </div>
      </Card>

      <div className="grid g-2" style={{ alignItems: "start" }}>
        <Card title="Rolls for this order" sub={`${o.rolls.length} booked · enough for about ${n(o.progress.bookedPieces)} bags`} pad={false}>
          {o.rolls.length === 0 ? <div className="empty">No fabric booked yet.</div> : (
            <div className="tbl-wrap"><table className="tbl">
              <thead><tr><th>Roll</th><th>Fabric</th><th className="num">Weight</th><th className="num">≈ Bags</th><th>Printed</th><th>Cut</th><th /></tr></thead>
              <tbody>{o.rolls.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.roll_no}</td>
                  <td>{r.color} · {r.size_in}″ · {r.gsm}</td>
                  <td className="num">{kg(r.net_kg)}</td>
                  <td className="num">{n(r.bags_out ?? r.est_bags)}{r.bags_out == null && <span className="dim"> est.</span>}</td>
                  <td>{r.printed_on ? <span title={r.print_machine}>{dateShort(r.printed_on)}</span> : <span className="dim">—</span>}</td>
                  <td>{r.cut_on ? <span title={r.cut_machine}>{dateShort(r.cut_on)}{r.waste_kg != null && <span className="dim"> · {r.waste_kg} kg waste</span>}</span> : <span className="dim">—</span>}</td>
                  <td className="num" style={{ whiteSpace: "nowrap" }}>
                    {can("orders") && !r.printed_on && open && <button className="btn small" onClick={() => undo.run({ title: `Release ${r.roll_no}?`, body: "It goes back to free stock.", confirmLabel: "Release", done: "Roll released" }, `/orders/${o.id}/unbook/${r.id}`)}>Release</button>}
                    {can("production") && r.printed_on && !r.cut_on && <button className="btn small" onClick={() => undo.run({ title: `Undo printing of ${r.roll_no}?`, body: "It goes back into the print queue.", confirmLabel: "Undo printing", done: "Printing undone" }, `/rolls/${r.id}/unprint`)}>Undo print</button>}
                    {can("production") && r.cut_on && <button className="btn small" onClick={() => undo.run({ title: `Undo cutting of ${r.roll_no}?`, body: `Removes ${n(r.bags_out)} bags from this order${r.loop_kg ? ` and returns ${r.loop_kg} kg of handles to stock` : ""}. It goes back into the cut queue.`, confirmLabel: "Undo cutting", done: "Cutting undone" }, `/rolls/${r.id}/uncut`)}>Undo cut</button>}
                  </td>
                </tr>))}
              </tbody>
            </table></div>
          )}
        </Card>

        <div className="stack">
          {can("orders") && open && remaining > 0 && (
            <Card title="Book fabric" sub={`Still need fabric for ${n(remaining)} bags`}
              action={o.candidates.length > 0 && <button className="btn small primary" disabled={act.busy} onClick={() => book()}>Auto-book</button>}>
              {o.candidates.length === 0 ? <div className="muted">No free {o.color} {o.gsm} GSM {o.quality} rolls in the {o.rollSize[0]}–{o.rollSize[1]}″ range. <Link className="card-link" to="/stock">Order fabric →</Link></div> : (
                <table className="tbl"><tbody>{o.candidates.map((r) => (
                  <tr key={r.id}><td className="mono">{r.roll_no}</td><td>{r.size_in}″ · {kg(r.net_kg)}</td><td className="num dim">≈ {n(r.est_bags)} bags</td>
                    <td className="num"><button className="btn small" disabled={act.busy} onClick={() => book([r.id])}>Book</button></td></tr>))}
                </tbody></table>
              )}
            </Card>
          )}
          <Card title="Sacks" sub={`${o.sacks.length} packed · ${n(o.progress.packed)} bags. Packed at the factory; moved only on the Dispatch page.`} pad={false}
            action={can("pack") && sel.length > 0 && <button className="btn small" onClick={async () => { if (await undo.run({ title: `Unpack ${sel.length} sack${sel.length > 1 ? "s" : ""}?`, body: "The bags go back to 'cut, waiting to be packed'.", confirmLabel: "Unpack", done: "Sacks unpacked" }, "/sacks/unpack", { ids: sel })) setSel([]); }}>Unpack {sel.length}</button>}>
            {o.sacks.length === 0 ? <div className="empty">Nothing packed yet.</div> : (
              <div className="tbl-wrap" style={{ maxHeight: 340 }}><table className="tbl">
                <thead><tr>{can("pack") && factorySacks.length > 0 && <th style={{ width: 34 }} />}<th>Sack</th><th className="num">Bags</th><th>Where</th><th>Challan</th></tr></thead>
                <tbody>{o.sacks.map((s) => (
                  <tr key={s.id}>
                    {can("pack") && factorySacks.length > 0 && <td>{s.status === "factory" && <input type="checkbox" className="check" aria-label={`Select ${s.sack_no}`} checked={sel.includes(s.id)} onChange={() => setSel((x) => x.includes(s.id) ? x.filter((i) => i !== s.id) : [...x, s.id])} />}</td>}
                    <td className="mono">{s.sack_no}</td><td className="num">{n(s.pieces)}</td>
                    <td><span className={`pill ${WHERE[s.status][0]}`}>{WHERE[s.status][1]}</span></td>
                    <td className="mono dim">{s.challan_no || "—"}</td></tr>))}
                </tbody>
              </table></div>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={!!pack} title="Pack bags" onClose={() => setPack(null)} onSubmit={savePack} submitLabel="Pack" busy={act.busy}>
        {pack && <>
          <div className="muted">{n(toPack)} cut bags are waiting to be packed. Sacks are created at the factory.</div>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            <Field label="Sacks"><input className="input" type="number" min="1" value={pack.sacks} onChange={(e) => setPack({ ...pack, sacks: e.target.value })} /></Field>
            <Field label="Bags per sack"><input className="input" type="number" min="1" value={pack.pieces} onChange={(e) => setPack({ ...pack, pieces: e.target.value })} /></Field>
            <Field label="Kg per sack"><input className="input" type="number" step="0.1" min="0.1" value={pack.kg} onChange={(e) => setPack({ ...pack, kg: e.target.value })} /></Field>
          </div>
          {act.error && <ErrorBox error={act.error} />}
        </>}
      </Dialog>
      {editing && <EditOrder o={o} meta={meta} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </div>
  );
}
