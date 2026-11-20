import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useData, useAction, useUndo, PageHead, Card, Loading, ErrorBox, Dialog, Field, Segmented, n, kg, dateShort, plural } from "../ui.jsx";
import { useAuth } from "../auth.jsx";

const dayWord = (s) => (s.day === 0 ? "Today" : s.day === 1 ? "Next working day" : dateShort(s.date));

/** Suggested machine + when, or why it can't be scheduled. */
function Suggestion({ s }) {
  if (!s) return <span className="dim">—</span>;
  if (s.problem) return <span className="sugg bad" title={s.problem}>Can't schedule</span>;
  return <span className="sugg"><b>{s.machine}</b><small>{dayWord(s)}</small></span>;
}

function Forecast({ summary }) {
  const risk = summary.atRisk;
  return (
    <div className="grid g-3" style={{ marginBottom: 20 }}>
      <div className="tile calm" style={{ cursor: "default" }}>
        <span className="tile-body"><span className="tile-label">Print queue clears in</span>
          <span className="tile-value">{summary.printDays}<small className="unit"> working day{summary.printDays === 1 ? "" : "s"}</small></span>
          <span className="tile-note">{summary.machines.printing.map((m) => `${m.name} ${m.per_day}/day`).join(" · ")}</span></span>
      </div>
      <div className="tile calm" style={{ cursor: "default" }}>
        <span className="tile-body"><span className="tile-label">Cut queue clears in</span>
          <span className="tile-value">{summary.cutDays}<small className="unit"> working day{summary.cutDays === 1 ? "" : "s"}</small></span>
          <span className="tile-note">{summary.machines.cutting.map((m) => `${m.name} ${m.per_day}/day`).join(" · ")}</span></span>
      </div>
      <div className={`tile ${risk.length || summary.blocked.length ? "warning" : "good"}`} style={{ cursor: "default" }}>
        <span className="tile-body"><span className="tile-label">Orders finishing after their due date</span>
          <span className="tile-value">{risk.length}</span>
          <span className="tile-note">{risk.length ? risk.slice(0, 3).map((o) => `${o.order_no} +${o.days_over}d`).join(" · ") : "All open orders on track"}{summary.blocked.length ? ` · ${plural(summary.blocked.length, "order")} can't be scheduled` : ""}</span></span>
      </div>
    </div>
  );
}

export default function Production() {
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") || "print";
  const { data: d, error, reload } = useData("/production");
  const act = useAction();
  const [job, setJob] = useState(null);
  const undo = useUndo(() => reload());
  const { can } = useAuth();
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Loading />;

  const printers = d.machines.filter((m) => m.kind === "printing");
  const cutters = d.machines.filter((m) => m.kind === "cutting");
  const rows = tab === "print" ? d.toPrint : tab === "cut" ? d.toCut : d.doneToday;

  const open = (r) => {
    const s = r.suggest?.[tab === "print" ? "print" : "cut"];
    const pool = tab === "print" ? printers : cutters;
    const machine_id = s?.machine_id ?? pool[0]?.id;
    setJob(tab === "print"
      ? { r, kind: "print", machine_id, print_kg: r.net_kg, suggested: s?.machine_id }
      : { r, kind: "cut", machine_id, bags_out: r.est_bags, waste_kg: +(r.net_kg * 0.04).toFixed(1), suggested: s?.machine_id });
  };
  const save = () => act.run(() => api(`/rolls/${job.r.id}/${job.kind}`, job), `${job.r.roll_no} marked ${job.kind === "print" ? "printed" : "cut"}`)
    .then((x) => { if (x) { setJob(null); reload(); } });
  const label = (m) => m.kind === "printing" ? `${m.name} · ${m.colours ?? "?"} colour${m.colours === 1 ? "" : "s"}` : `${m.name} · ${(m.bag_types || "any bag").split(",").join(", ")}`;

  return (
    <>
      <PageHead eyebrow="Production" title={<>On the <em>floor</em></>}>
        Each roll gets a suggested machine: one that can handle its colours, cylinder and bag type, and is free soonest, most urgent delivery first.
      </PageHead>
      <Forecast summary={d.summary} />
      <div style={{ marginBottom: 16 }}>
        <Segmented value={tab} onChange={(v) => setParams(v === "print" ? {} : { tab: v })} options={[
          { value: "print", label: "To print", count: d.toPrint.length },
          { value: "cut", label: "To cut", count: d.toCut.length },
          { value: "done", label: "Done today", count: d.doneToday.length },
        ]} />
      </div>
      {undo.error && <div style={{ marginBottom: 12 }}><ErrorBox error={undo.error} /></div>}
      <Card pad={false}>
        {rows.length === 0 ? <div className="empty">{tab === "done" ? "Nothing finished yet today." : "Queue is empty."}</div> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Roll</th><th>Order</th><th>Bag</th><th>Fabric</th>
              {tab === "print" && <th className="num">Cylinder</th>}{tab === "print" && <th>Print</th>}
              {tab !== "print" && <th className="num">{tab === "done" ? "Bags" : "≈ Bags"}</th>}
              {tab === "done" ? <th>Machine</th> : <th>Suggested</th>}
              <th>Due</th><th /></tr></thead>
            <tbody>{rows.map((r) => {
              const s = r.suggest?.[tab === "print" ? "print" : "cut"];
              const late = tab !== "done" && r.suggest?.cut?.date && r.suggest.cut.date > r.due_date;
              return (
                <tr key={r.id}>
                  <td className="mono">{r.roll_no}</td>
                  <td><Link to={`/orders/${r.order_id}`}><b>{r.order_no}</b></Link><div className="dim" style={{ fontSize: 12 }}>{r.client}</div></td>
                  <td>{r.bag_type_name} · {r.w}×{r.l}{r.g ? `×${r.g}` : ""}</td>
                  <td>{r.color} · {r.size_in}″ · {r.gsm}</td>
                  {tab === "print" && <td className="num">{r.cylinder}″</td>}
                  {tab === "print" && <td className="dim">{r.print_colors}</td>}
                  {tab !== "print" && <td className="num">{n(r.bags_out ?? r.est_bags)}</td>}
                  {tab === "done" ? <td className="dim">{r.cut_on ? r.cut_machine : r.print_machine}</td> : <td><Suggestion s={s} /></td>}
                  <td>{dateShort(r.due_date)}{late && <div className="late-flag">Cut {dateShort(r.suggest.cut.date)}, after due</div>}</td>
                  <td className="num">
                    {can("production") && tab !== "done" && <button className="btn small" onClick={() => open(r)}>{tab === "print" ? "Printed" : "Cut"}</button>}
                    {can("production") && tab === "done" && (r.cut_on
                      ? <button className="btn small" onClick={() => undo.run({ title: `Undo cutting of ${r.roll_no}?`, body: `Removes ${n(r.bags_out)} bags from ${r.order_no}${r.loop_kg ? ` and returns ${r.loop_kg} kg of handles to stock` : ""}.`, confirmLabel: "Undo cutting", done: "Cutting undone" }, `/rolls/${r.id}/uncut`)}>Undo cut</button>
                      : <button className="btn small" onClick={() => undo.run({ title: `Undo printing of ${r.roll_no}?`, body: "It goes back into the print queue.", confirmLabel: "Undo printing", done: "Printing undone" }, `/rolls/${r.id}/unprint`)}>Undo print</button>)}
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table></div>
        )}
      </Card>
      <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>
        Forecast assumes each machine's rolls-per-day from Settings, Sundays off, and cutting the working day after printing. Change a machine's capability in Settings → Machines.
      </p>

      <Dialog open={!!job} title={job ? `${job.r.roll_no} · ${job.kind === "print" ? "printed" : "cut"}` : ""} onClose={() => { setJob(null); act.setError(null); }} onSubmit={save} submitLabel="Save" busy={act.busy}>
        {job && <>
          <div className="muted">{job.r.order_no} · {job.r.client} · {job.r.color} {job.r.size_in}″ {job.r.gsm} GSM · {kg(job.r.net_kg)}{job.kind === "print" ? ` · ${job.r.cylinder}″ cylinder · ${job.r.print_colors}` : ` · ${job.r.bag_type_name}`}</div>
          <Field label="Machine" hint={job.suggested && Number(job.machine_id) !== job.suggested ? "Not the suggested machine. The system will refuse it if it can't do this job." : job.suggested ? "Suggested machine" : undefined}>
            <select className="input" value={job.machine_id} onChange={(e) => setJob({ ...job, machine_id: Number(e.target.value) })}>
              {(job.kind === "print" ? printers : cutters).map((m) => <option key={m.id} value={m.id}>{label(m)}{m.id === job.suggested ? "  ✓ suggested" : ""}</option>)}
            </select>
          </Field>
          {job.kind === "print" ? (
            <Field label="Weight after printing (kg)"><input className="input" type="number" step="0.1" value={job.print_kg} onChange={(e) => setJob({ ...job, print_kg: e.target.value })} /></Field>
          ) : (
            <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <Field label="Bags produced" hint={`Formula estimate: ${n(job.r.est_bags)}`}><input className="input" type="number" min="1" value={job.bags_out} onChange={(e) => setJob({ ...job, bags_out: e.target.value })} /></Field>
              <Field label="Waste (kg)" hint="Offcuts & rejects"><input className="input" type="number" step="0.1" min="0" value={job.waste_kg} onChange={(e) => setJob({ ...job, waste_kg: e.target.value })} /></Field>
            </div>
          )}
          {act.error && <ErrorBox error={act.error} />}
        </>}
      </Dialog>
    </>
  );
}
