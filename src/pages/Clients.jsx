import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useData, PageHead, Card, Loading, ErrorBox, Segmented, StagePill, n, dateShort, dueText } from "../ui.jsx";
import { useAuth } from "../auth.jsx";
import ClientDialog from "../ClientDialog.jsx";

const money = (v) => `₹${Math.round(v).toLocaleString("en-IN")}`;

export function ClientList() {
  const { data, error, reload } = useData("/clients");
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [show, setShow] = useState("active");
  const [adding, setAdding] = useState(false);
  if (error) return <ErrorBox error={error} />;

  const rows = (data || [])
    .filter((c) => (show === "active" ? c.active : !c.active))
    .filter((c) => !q || `${c.name} ${c.city || ""} ${c.agent || ""} ${c.phone || ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead eyebrow="Clients" title="Clients" actions={can("orders") && <button className="btn primary" onClick={() => setAdding(true)}>Register client</button>}>
        Everyone you make bags for. Register a new client here (or straight from the order form), then click a client to see their orders.
      </PageHead>
      <div className="spread wrap" style={{ marginBottom: 16 }}>
        <Segmented value={show} onChange={setShow} options={[
          { value: "active", label: "Active", count: data?.filter((c) => c.active).length },
          { value: "inactive", label: "Inactive", count: data?.filter((c) => !c.active).length },
        ]} />
        <input className="input search" placeholder="Search name, city, agent or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card pad={false}>
        {!data ? <Loading /> : rows.length === 0 ? <div className="empty">{q ? "No clients match." : "No clients here yet."}</div> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Client</th><th>Contact</th><th>Agent</th><th className="num">Open orders</th><th className="num">All orders</th><th className="num">Bags ordered</th>{can("money") && <th className="num">Business</th>}<th>Last order</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className="click" onClick={() => nav(`/clients/${c.id}`)}>
                <td><b>{c.name}</b><div className="dim" style={{ fontSize: 12 }}>{[c.address, c.city].filter(Boolean).join(", ") || "No address yet"}</div></td>
                <td className="mono dim">{c.phone || "—"}</td>
                <td>{c.agent || <span className="dim">—</span>}</td>
                <td className="num">{c.open_orders ? <b>{c.open_orders}</b> : <span className="dim">0</span>}</td>
                <td className="num">{c.orders}</td>
                <td className="num">{n(c.bags)}</td>
                {can("money") && <td className="num">{c.value ? money(c.value) : "—"}</td>}
                <td>{c.last_order ? dateShort(c.last_order) : <span className="dim">Never</span>}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      {adding && <ClientDialog onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); reload(); nav(`/clients/${id}`); }} />}
    </>
  );
}

export function ClientDetail() {
  const { id } = useParams();
  const { data: c, error, reload } = useData(`/clients/${id}`);
  const { can } = useAuth();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  if (error) return <ErrorBox error={error} />;
  if (!c) return <Loading />;

  const open = c.orders.filter((o) => o.status === "open");
  const past = c.orders.filter((o) => o.status !== "open");
  const value = c.orders.filter((o) => o.status !== "cancelled" && o.rate).reduce((a, o) => a + o.rate * o.qty, 0);

  const table = (list) => (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr><th>Order</th><th>Bag</th><th className="num">Qty</th><th>Ordered</th><th>Due</th><th>Stage</th></tr></thead>
      <tbody>{list.map((o) => (
        <tr key={o.id} className="click" onClick={() => nav(`/orders/${o.id}`)}>
          <td><b>{o.order_no}</b></td>
          <td>{o.bag_type_name} · {o.size}″<div className="dim" style={{ fontSize: 12 }}>{o.color} · {o.gsm} GSM</div></td>
          <td className="num">{n(o.qty)}</td>
          <td>{dateShort(o.order_date)}</td>
          <td>{dateShort(o.due_date)}{o.status === "open" && <div style={{ fontSize: 12, color: o.late ? "var(--critical)" : "var(--muted)" }}>{dueText(o.daysLeft)}</div>}</td>
          <td>{o.status === "cancelled" ? <span className="pill plain">Cancelled</span> : <StagePill o={o} />}</td>
        </tr>))}
      </tbody>
    </table></div>
  );

  return (
    <div className="stack">
      <PageHead eyebrow={<Link to="/clients">← Clients</Link>} title={<>{c.name}{!c.active && <em> · inactive</em>}</>}
        actions={<>
          {can("orders") && <button className="btn" onClick={() => setEditing(true)}>Edit</button>}
          {can("orders") && c.active ? <Link className="btn primary" to={`/orders/new?client=${c.id}`}>New order</Link> : null}
        </>}>
        {[c.address, c.city].filter(Boolean).join(", ") || "No address on file. Add one so it prints on challans."}
      </PageHead>

      <Card>
        <div className="facts">
          <div className="fact"><span>Phone</span><b>{c.phone || "—"}</b></div>
          <div className="fact"><span>GSTIN</span><b className="mono">{c.gstin || "—"}</b></div>
          <div className="fact"><span>Agent</span><b>{c.agent || "—"}</b></div>
          <div className="fact"><span>Orders</span><b>{c.orders.filter((o) => o.status !== "cancelled").length}{can("money") && value ? ` · ${money(value)}` : ""}</b></div>
        </div>
      </Card>

      <Card title="Open orders" sub={open.length ? `${open.length} in progress` : undefined} pad={false}>
        {open.length ? table(open) : <div className="empty">No open orders.</div>}
      </Card>
      {past.length > 0 && <Card title="Past orders" sub="Delivered and cancelled" pad={false}>{table(past)}</Card>}

      {editing && <ClientDialog client={c} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reload(); }} />}
    </div>
  );
}
