import { useState } from "react";
import { Link } from "react-router-dom";
import { useData, Card, Loading, ErrorBox, n, kg, dateLong, dateShort, dayName, dayNum, plural } from "../ui.jsx";
import { useAuth } from "../auth.jsx";
import { StatTile, StageBar, Columns, MeterList, Icon, compact } from "../charts.jsx";

function greeting(name) {
  const h = new Date().getHours();
  return `${h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"}, ${name.split(" ")[0]}`;
}

const STATUS = { fabric: "Waiting for fabric", printing: "Being printed", cutting: "Being cut", packing: "Being packed", ready: "Packed, ready to send" };
const lateText = (d) => (d === -1 ? "1 day late" : `${-d} days late`);

/** A short, ranked list of the things someone has to act on. */
function attentionItems(d) {
  const items = [];
  for (const o of d.schedule.overdue)
    items.push({ tone: "critical", icon: "alert", text: <><b>{o.client}</b> · {o.order_no} is {lateText(o.daysLeft)}</>, sub: STATUS[o.stage], to: `/orders/${o.id}` });
  for (const o of d.schedule.days[0].orders.filter((o) => o.stage !== "ready"))
    items.push({ tone: "warning", icon: "clock", text: <><b>{o.client}</b> · {o.order_no} is due today</>, sub: `${STATUS[o.stage]}, not packed yet`, to: `/orders/${o.id}` });
  for (const o of d.atRisk)
    items.push({ tone: "warning", icon: "clock", text: <><b>{o.client}</b> · {o.order_no} will miss its date</>,
      sub: `At current machine capacity it's ready ${dateShort(o.ready_date)}, ${o.days_over} day${o.days_over > 1 ? "s" : ""} after the promised ${dateShort(o.due_date)}`, to: "/production" });
  for (const o of d.blocked)
    items.push({ tone: "critical", icon: "alert", text: <><b>{o.order_no}</b> can't be scheduled</>, sub: o.problem, to: "/production" });
  for (const f of d.fabric.filter((f) => f.status === "short"))
    items.push({ tone: "warning", icon: "roll", text: <><b>{f.color} fabric</b> {f.size_in}″ · {f.gsm} GSM is running out</>,
      sub: f.demand_kg > f.stock_kg ? `${kg(f.stock_kg)} in stock, ${kg(f.demand_kg)} needed for ${f.demand_orders.join(", ")}` : `${kg(f.stock_kg)} in stock, minimum is ${kg(f.min_kg)}`, to: "/stock" });
  for (const l of d.loops.filter((l) => l.balance_kg < l.min_kg))
    items.push({ tone: "warning", icon: "roll", text: <><b>{l.color} handles</b> are below minimum</>, sub: `${kg(l.balance_kg)} in stock, minimum is ${kg(l.min_kg)}`, to: "/settings" });
  return items;
}

function Attention({ items }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 5);
  return (
    <Card title="Needs attention" sub={items.length ? `${plural(items.length, "item")}, most urgent first` : undefined}>
      {items.length === 0 ? <p className="all-good"><Icon name="check" /> Nothing urgent. Everything is on track.</p> : (
        <>
          <ul className="attn">
            {shown.map((it, i) => (
              <li key={i}>
                <Link to={it.to} className={`attn-row ${it.tone}`}>
                  <span className="attn-icon"><Icon name={it.icon} size={16} /></span>
                  <span><span className="attn-text">{it.text}</span><span className="attn-sub">{it.sub}</span></span>
                  <span className="attn-go" aria-hidden>→</span>
                </Link>
              </li>
            ))}
          </ul>
          {items.length > 5 && <button className="link-btn" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${items.length}`}</button>}
        </>
      )}
    </Card>
  );
}

const FABRIC_STATUS = {
  short: ["critical", "Short"], covered: ["warning", "Arriving"], low: ["warning", "Low"], ok: ["good", "OK"],
};

export default function Today() {
  const { data: d, error } = useData("/dashboard", { refresh: 60000 });
  const { can, user } = useAuth();
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;
  const h = d.headline;
  const ready = d.stageCounts.find((s) => s.key === "ready").count;

  const due = [
    { key: "late", label: "Late", value: d.schedule.overdue.length, tone: "critical", tip: "Past their delivery date" },
    ...d.schedule.days.map((day, i) => ({
      key: day.date, label: i === 0 ? "Today" : dayName(day.date), sub: i === 0 ? null : dayNum(day.date), value: day.orders.length, strong: i === 0,
      tip: `${dateLong(day.date)}${day.orders.length ? "\n" + day.orders.map((o) => `${o.client} · ${n(o.qty)} bags`).join("\n") : ""}`,
    })),
  ];
  const output = d.output.map((o, i) => ({ key: o.date, label: i === 6 ? "Today" : dayName(o.date), sub: i === 6 ? null : dayNum(o.date), value: o.bags, strong: i === 6, tip: `${dateLong(o.date)}\n${o.rolls} rolls cut` }));
  const weekBags = d.output.reduce((a, o) => a + o.bags, 0);

  const fabricRows = d.fabric.map((f) => ({
    key: f.label + f.quality, color: f.color, name: f.color, detail: `${f.size_in}″ · ${f.gsm} GSM · ${f.quality}`,
    value: f.stock_kg, target: Math.max(f.min_kg, f.demand_kg), status: FABRIC_STATUS[f.status][0],
    statusLabel: f.status === "covered" && f.next_eta ? `Arriving ${dateShort(f.next_eta)}` : FABRIC_STATUS[f.status][1],
    tip: `${f.label} · ${f.quality}\nIn stock: ${kg(f.stock_kg)} (${f.stock_rolls} rolls)\nMinimum: ${kg(f.min_kg)}${f.demand_kg ? `\nNeeded for orders: ${kg(f.demand_kg)}` : ""}${f.transit_kg ? `\nOn the way: ${kg(f.transit_kg)}` : ""}`,
  }));
  const loopRows = d.loops.map((l) => {
    const st = l.balance_kg < l.min_kg ? "short" : l.balance_kg < l.min_kg * 1.5 ? "low" : "ok";
    return { key: l.id, color: l.color, name: l.color, value: l.balance_kg, target: l.min_kg, status: FABRIC_STATUS[st][0], statusLabel: FABRIC_STATUS[st][1], tip: `${l.color} handles\nIn stock: ${kg(l.balance_kg)}\nMinimum: ${kg(l.min_kg)}` };
  });

  return (
    <div className="stack">
      <header className="page-head" style={{ marginBottom: 0 }}>
        <div><div className="eyebrow">{dateLong(d.today)}</div><h1 className="title">{greeting(user.name)}</h1></div>
        {can("orders") && <Link to="/orders/new" className="btn primary">New order</Link>}
      </header>

      <div className="tiles">
        <StatTile label="Late orders" value={h.overdue} icon="alert" tone={h.overdue ? "critical" : "calm"} note={h.overdue ? "Past delivery date" : "None late"} to="/orders?stage=late" />
        <StatTile label="Due today" value={h.dueToday} icon="clock" tone={h.dueToday ? "warning" : "calm"} note={`${h.dueWeek} due this week`} to="/orders" />
        <StatTile label="Ready to ship" value={ready} icon="truck" tone="good" note="Packed, waiting for a truck" to="/dispatch" />
        <StatTile label="Fabric running out" value={h.shortFabric} icon="roll" tone={h.shortFabric ? "warning" : "calm"} note={h.lowLoops ? `+ ${plural(h.lowLoops, "handle colour")} low` : "Handles OK"} to="/stock" />
      </div>

      <Card title="Open orders by stage" sub={`${h.open} orders on the books. Click a stage to see them.`}>
        <StageBar stages={d.stageCounts} />
      </Card>

      <div className="grid g-2e">
        <Card title="Deliveries due" sub="Orders promised, by day" action={<Link className="card-link" to="/orders">All orders →</Link>}>
          <Columns data={due} unit="orders" />
        </Card>
        <Attention items={attentionItems(d)} />
      </div>

      <div className="grid g-2e">
        <Card title="Fabric in stock" sub="Free rolls against what's needed (minimum or open orders)" action={<Link className="card-link" to="/stock">Stock →</Link>}>
          <MeterList rows={fabricRows} />
        </Card>
        <div className="stack">
          <Card title="Bags produced" sub={`${n(weekBags)} bags cut in the last 7 days · ${h.wastePct}% fabric waste`} action={<Link className="card-link" to="/production">Production →</Link>}>
            <Columns data={output} height={120} format={compact} unit="bags" />
          </Card>
          <Card title="Handles in stock" sub="Against minimum level">
            <MeterList rows={loopRows} />
          </Card>
        </div>
      </div>
    </div>
  );
}
