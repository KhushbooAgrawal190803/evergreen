import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useData, PageHead, Card, Loading, ErrorBox, Segmented, StagePill, Track, n, dateShort, dueText } from "../ui.jsx";
import { useAuth } from "../auth.jsx";

const FILTERS = [
  { value: "all", label: "All open" }, { value: "late", label: "Late" }, { value: "fabric", label: "Awaiting fabric" },
  { value: "printing", label: "Printing" }, { value: "cutting", label: "Cutting" }, { value: "packing", label: "Packing" }, { value: "ready", label: "Ready to ship" },
];
const match = (o, f) => f === "all" || (f === "late" ? o.late : o.stage === f);

export default function Orders() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState("");
  const [closed, setClosed] = useState(null); // null = open orders, else "delivered" | "cancelled"
  const filter = params.get("stage") || "all";
  const { data, error } = useData(closed ? `/orders?status=${closed}` : "/orders");
  const nav = useNavigate();
  const { can } = useAuth();
  if (error) return <ErrorBox error={error} />;
  const rows = (data || []).filter((o) => closed || match(o, filter))
    .filter((o) => !q || `${o.order_no} ${o.client} ${o.color}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead eyebrow="Orders" title="Order book" actions={can("orders") && <Link to="/orders/new" className="btn primary">New order</Link>}>
        Every order from punch to delivery. Click one to book fabric, see its rolls, or pack it.
      </PageHead>
      <div className="spread wrap" style={{ marginBottom: 16 }}>
        <div className="row wrap">
          <Segmented value={closed ? "" : filter} onChange={(v) => { setClosed(null); setParams(v === "all" ? {} : { stage: v }); }}
            options={FILTERS.map((f) => ({ ...f, count: data && !closed ? data.filter((o) => match(o, f.value)).length : undefined }))} />
          <button className={`btn small ${closed === "delivered" ? "primary" : ""}`} onClick={() => setClosed(closed === "delivered" ? null : "delivered")}>Delivered</button>
          <button className={`btn small ${closed === "cancelled" ? "primary" : ""}`} onClick={() => setClosed(closed === "cancelled" ? null : "cancelled")}>Cancelled</button>
        </div>
        <input className="input search" placeholder="Search order, client or colour…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card pad={false}>
        {!data ? <Loading /> : rows.length === 0 ? <div className="empty">No orders here.</div> : (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Order</th><th>Client</th><th>Bag</th><th className="num">Qty</th><th>Due</th><th>Stage</th><th>Progress</th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
                    <td><b>{o.order_no}</b></td>
                    <td>{o.client}<div className="dim" style={{ fontSize: 12 }}>{o.city} · {o.agent}</div></td>
                    <td>{o.bag_type_name} · {o.size}″<div className="dim" style={{ fontSize: 12 }}>{o.color} · {o.gsm} GSM · {o.quality}</div></td>
                    <td className="num">{n(o.qty)}</td>
                    <td>{dateShort(o.due_date)}<div style={{ fontSize: 12, color: o.late ? "var(--danger)" : "var(--muted)" }}>{o.status === "cancelled" ? "Cancelled" : o.stage === "delivered" ? "Delivered" : dueText(o.daysLeft)}</div></td>
                    <td><StagePill o={o} /></td>
                    <td><Track o={o} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
