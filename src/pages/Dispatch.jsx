import { useState } from "react";
import { Link } from "react-router-dom";
import { api, useData, useAction, useUndo, PageHead, Card, Loading, ErrorBox, Dialog, Field, n, kg, dateShort } from "../ui.jsx";
import { useAuth } from "../auth.jsx";

const COLS = [
  { key: "factory", title: "Packed at factory", sub: "Ready to move" },
  { key: "godown", title: "In godown", sub: "Waiting for a truck to the client" },
];

export default function Dispatch() {
  const { data: d, error, reload } = useData("/sacks");
  const act = useAction();
  const [sel, setSel] = useState([]);          // selected group keys
  const [move, setMove] = useState(null);       // { to, vehicle }
  const [made, setMade] = useState(null);       // last challan created
  const { can } = useAuth();
  const undo = useUndo(() => { setSel([]); reload(); });
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;

  const key = (g) => `${g.order_id}|${g.status}`;
  const chosen = d.groups.filter((g) => sel.includes(key(g)));
  const ids = chosen.flatMap((g) => g.sacks);
  const fromStatuses = [...new Set(chosen.map((g) => g.status))];
  const save = () => act.run(() => api("/sacks/move", { ids, ...move }), (r) => `Challan ${r.challan_no} created`)
    .then((r) => { if (r) { setMove(null); setSel([]); setMade(r); reload(); } });

  return (
    <div className="stack">
      <PageHead eyebrow="Dispatch" title={<>Out the <em>door</em></>}
        actions={can("dispatch") && <>
          {fromStatuses.length === 1 && fromStatuses[0] === "godown"
            ? <button className="btn" onClick={() => setMove({ to: "factory" })}>Move back to factory</button>
            : <button className="btn" disabled={!ids.length || fromStatuses.includes("godown")} onClick={() => setMove({ to: "godown" })}>Move to godown</button>}
          <button className="btn primary" disabled={!ids.length} onClick={() => setMove({ to: "dispatched" })}>Send to client</button>
        </>}>
        Sacks are packed at the factory. They change place only through a challan here, and a challan made by mistake can be cancelled below.
      </PageHead>
      {(act.error || undo.error) && <ErrorBox error={act.error || undo.error} />}
      {made && <div className="notice"><span>Challan <b>{made.challan_no}</b> created. Print it to send with the driver.</span>
        <span className="row"><Link className="btn small primary" to={`/challans/${made.id}`}>Print challan</Link><button className="btn small" onClick={() => setMade(null)}>Dismiss</button></span></div>}
      <div className="grid g-2e" style={{ alignItems: "start" }}>
        {COLS.map((c) => {
          const groups = d.groups.filter((g) => g.status === c.key);
          return (
            <Card key={c.key} title={c.title} sub={`${c.sub} · ${n(groups.reduce((a, g) => a + g.sacks.length, 0))} sacks`} pad={false}>
              {groups.length === 0 ? <div className="empty">Empty.</div> : (
                <table className="tbl"><tbody>{groups.map((g) => (
                  <tr key={key(g)} className="click" onClick={() => setSel((s) => s.includes(key(g)) ? s.filter((x) => x !== key(g)) : [...s, key(g)])}>
                    <td style={{ width: 36 }}><input type="checkbox" className="check" readOnly checked={sel.includes(key(g))} /></td>
                    <td><b>{g.client}</b><div className="dim" style={{ fontSize: 12 }}><Link to={`/orders/${g.order_id}`} onClick={(e) => e.stopPropagation()}>{g.order_no}</Link> · {g.city} · due {dateShort(g.due_date)}</div></td>
                    <td className="num">{g.sacks.length} sacks<div className="dim" style={{ fontSize: 12 }}>{n(g.pieces)} bags · {kg(g.kg)}</div></td>
                  </tr>))}
                </tbody></table>
              )}
            </Card>
          );
        })}
      </div>
      <Card title="Recent challans" pad={false}>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Challan</th><th>Date</th><th>Movement</th><th>Vehicle</th><th>Orders</th><th className="num">Sacks</th><th className="num">Bags</th><th /></tr></thead>
          <tbody>{d.challans.map((c) => (
            <tr key={c.id} style={{ opacity: c.cancelled_on ? 0.55 : 1 }}>
              <td className="mono">{c.challan_no}</td><td>{dateShort(c.date)}</td><td>{c.kind}</td><td className="mono dim">{c.vehicle}</td>
              <td>{c.orders || "—"}</td><td className="num">{c.sacks || "—"}</td><td className="num">{c.pieces ? n(c.pieces) : "—"}</td>
              <td className="num" style={{ whiteSpace: "nowrap" }}><Link className="btn small" to={`/challans/${c.id}`}>Print</Link>{" "}{c.cancelled_on ? <span className="pill plain">Cancelled</span> : can("dispatch") && c.canCancel &&
                <button className="btn small" onClick={() => undo.run({ title: `Cancel challan ${c.challan_no}?`, body: `The ${c.current} sack${c.current > 1 ? "s" : ""} on it go back to where they were before${c.kind === "To client" ? ", and the order reopens if it was closed by this delivery" : ""}.`, reason: "Why is it being cancelled?", confirmLabel: "Cancel challan", done: "Challan cancelled" }, `/challans/${c.id}/cancel`)}>Cancel</button>}
              </td></tr>))}
          </tbody>
        </table></div>
      </Card>

      <Dialog open={!!move} title={{ godown: "Move to godown", factory: "Move back to factory", dispatched: "Send to client" }[move?.to]} onClose={() => { setMove(null); act.setError(null); }} onSubmit={save} submitLabel="Create challan" busy={act.busy}>
        {move && <>
          <div className="muted">{ids.length} sacks · {n(chosen.reduce((a, g) => a + g.pieces, 0))} bags from {chosen.map((g) => g.order_no).join(", ")}</div>
          <Field label="Vehicle number"><input className="input" required placeholder="WB-12-3456" value={move.vehicle || ""} onChange={(e) => setMove({ ...move, vehicle: e.target.value })} /></Field>
          {move.to === "dispatched" && <Field label="Destination"><input className="input" value={move.destination || chosen[0]?.city || ""} onChange={(e) => setMove({ ...move, destination: e.target.value })} /></Field>}
          {act.error && <ErrorBox error={act.error} />}
        </>}
      </Dialog>
    </div>
  );
}
