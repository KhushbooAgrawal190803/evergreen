import { useState } from "react";
import { api, useAction, useData, Dialog, Field, ErrorBox } from "./ui.jsx";

/** Register a new client (client = null) or edit an existing one. Calls onSaved(id). */
export default function ClientDialog({ client, onClose, onSaved }) {
  const isNew = !client?.id;
  const act = useAction();
  const { data: clients } = useData("/clients");
  const agents = [...new Set((clients || []).map((c) => c.agent).filter(Boolean))].sort();
  const [f, setF] = useState({ name: "", address: "", city: "", phone: "", gstin: "", agent: "", ...client, active: client ? !!client.active : true });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  // Warn (don't block) when the name is close to an existing client, to avoid duplicates.
  const similar = isNew && f.name.trim().length >= 3
    ? (clients || []).filter((c) => c.name.toLowerCase().includes(f.name.trim().toLowerCase()) || f.name.trim().toLowerCase().includes(c.name.toLowerCase())).slice(0, 3)
    : [];

  const save = () => act.run(
    () => api(isNew ? "/clients" : `/clients/${client.id}`, f),
    isNew ? `${f.name} registered` : `${f.name} updated`,
  ).then((r) => r && onSaved(isNew ? r.id : client.id));

  return (
    <Dialog open title={isNew ? "Register a new client" : `Edit ${client.name}`} onClose={onClose} onSubmit={save} submitLabel={isNew ? "Register client" : "Save"} busy={act.busy}>
      <Field label="Business name">
        <input className="input" required autoFocus value={f.name} onChange={set("name")} />
      </Field>
      {similar.length > 0 && <div className="hint-warn">Similar existing client{similar.length > 1 ? "s" : ""}: {similar.map((c) => `${c.name}${c.city ? ` (${c.city})` : ""}`).join(", ")}. Check it isn't a duplicate.</div>}
      <Field label="Address" hint="Printed on delivery challans"><input className="input" value={f.address || ""} onChange={set("address")} /></Field>
      <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Field label="City"><input className="input" value={f.city || ""} onChange={set("city")} /></Field>
        <Field label="Phone"><input className="input" type="tel" value={f.phone || ""} onChange={set("phone")} /></Field>
        <Field label="GSTIN" hint="Optional · 15 characters"><input className="input" maxLength={15} style={{ textTransform: "uppercase" }} value={f.gstin || ""} onChange={set("gstin")} /></Field>
        <Field label="Agent / broker">
          <input className="input" list="agents" value={f.agent || ""} onChange={set("agent")} />
          <datalist id="agents">{agents.map((a) => <option key={a} value={a} />)}</datalist>
        </Field>
      </div>
      {!isNew && <label className="row" style={{ fontSize: 13.5 }}><input type="checkbox" className="check" checked={f.active} onChange={set("active")} /> Active (untick to stop taking new orders; past orders are kept)</label>}
      {act.error && <ErrorBox error={act.error} />}
    </Dialog>
  );
}
