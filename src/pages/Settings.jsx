import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useData, useAction, useUndo, useToast, PageHead, Card, Loading, ErrorBox, Dialog, Field, Segmented, kg, ago } from "../ui.jsx";
import { useAuth, PasswordForm } from "../auth.jsx";
import { Swatch } from "../charts.jsx";

// ── Reference data ───────────────────────────────
// Clients, suppliers and machines are deactivated rather than deleted, so past orders keep their history.
const Status = ({ active }) => active ? <span className="pill ok plain">Active</span> : <span className="pill plain">Inactive</span>;

const FORMS = {
  client: { title: (v) => (v.id ? `Edit ${v.name}` : "New client"), path: (v) => (v.id ? `/clients/${v.id}` : "/clients"),
    fields: [["name", "Name", { required: true, span: 3 }], ["address", "Address (printed on challans)", { span: 3 }], ["city", "City"], ["phone", "Phone"], ["agent", "Agent"], ["gstin", "GSTIN"]], active: true },
  vendor: { title: (v) => (v.id ? `Edit ${v.name}` : "New supplier"), path: (v) => (v.id ? `/vendors/${v.id}` : "/vendors"),
    fields: [["name", "Name", { required: true, span: 3 }], ["city", "City"], ["phone", "Phone"]], active: true },
  machine: { title: (v) => (v.id ? `Edit ${v.name}` : "New machine"), path: (v) => (v.id ? `/machines/${v.id}` : "/machines"),
    fields: [["name", "Name", { required: true, span: 2 }], ["per_day", "Rolls per working day", { type: "number" }]], kind: true, active: true },
  limit: { title: () => "Fabric minimum", path: () => "/limits",
    fields: [["color", "Colour", { required: true }], ["size_in", "Width (in)", { required: true, type: "number", step: "0.5" }], ["gsm", "GSM", { required: true, type: "number" }], ["min_kg", "Minimum (kg)", { required: true, type: "number" }]], quality: true },
  loop: { title: (v) => (v.id ? `${v.color} handles` : "New handle colour"), path: (v) => (v.id ? `/loops/${v.id}` : "/loops"),
    fields: [["color", "Colour", { required: true, newOnly: true }], ["balance_kg", "Stock now (kg)", { type: "number", newOnly: true }], ["min_kg", "Minimum (kg)", { required: true, type: "number" }]] },
};

function Reference() {
  const { data: m, error, reload } = useData("/meta");
  const { can } = useAuth();
  const ok = can("settings");
  const act = useAction();
  const undo = useUndo(reload);
  const [edit, setEdit] = useState(null); // { type, v }
  if (error) return <ErrorBox error={error} />;
  if (!m) return <Loading />;

  const form = edit && FORMS[edit.type];
  const save = () => {
    const body = edit.type === "loop" && edit.v.id ? { balance_kg: edit.v.balance_kg, min_kg: edit.v.min_kg } : edit.v;
    return act.run(() => api(form.path(edit.v), body), "Saved").then((r) => { if (r) { setEdit(null); reload(); } });
  };
  const set = (k) => (e) => setEdit({ ...edit, v: { ...edit.v, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value } });
  const editBtn = (type, v) => ok && <button className="btn small" onClick={() => setEdit({ type, v: { ...v, active: v.active === undefined ? true : !!v.active } })}>Edit</button>;
  const addBtn = (type, v = {}) => ok && <button className="btn small" onClick={() => setEdit({ type, v })}>Add</button>;

  return (
    <div className="stack">
      {undo.error && <ErrorBox error={undo.error} />}
      <div className="grid g-2e" style={{ alignItems: "start" }}>
        <Card title="Fabric minimums" sub="The dashboard warns when free stock falls below this" pad={false} action={addBtn("limit", { quality: "Standard" })}>
          <table className="tbl"><thead><tr><th>Fabric</th><th>Quality</th><th className="num">Minimum</th><th /></tr></thead>
            <tbody>{m.limits.map((l) => (
              <tr key={l.id}><td><Swatch color={l.color} /> {l.color} · {l.size_in}″ · {l.gsm} GSM</td><td>{l.quality}</td><td className="num">{kg(l.min_kg)}</td>
                <td className="num" style={{ whiteSpace: "nowrap" }}>{editBtn("limit", l)}{ok && <> <button className="btn small" onClick={() => undo.run({ title: "Remove this minimum?", body: `${l.color} ${l.size_in}″ ${l.gsm} GSM will no longer raise low-stock warnings. You can add it again any time.`, confirmLabel: "Remove", done: "Minimum removed" }, `/limits/${l.id}/delete`)}>Remove</button></>}</td></tr>))}
            </tbody></table>
        </Card>
        <div className="stack">
          <Card title="Handle colours" sub="Stock changes on the Fabric & stock page" pad={false} action={addBtn("loop", { balance_kg: 0, min_kg: 0 })}>
            <table className="tbl"><thead><tr><th>Colour</th><th className="num">In stock</th><th className="num">Minimum</th><th /></tr></thead>
              <tbody>{m.loops.map((l) => (
                <tr key={l.id}><td><Swatch color={l.color} /> {l.color}</td><td className="num">{kg(l.balance_kg)}</td><td className="num">{kg(l.min_kg)}</td>
                  <td className="num">{editBtn("loop", l)}</td></tr>))}
              </tbody></table>
          </Card>
          <Card title="Machines" sub="Capabilities drive the production suggestions" pad={false} action={addBtn("machine", { kind: "printing" })}>
            <table className="tbl"><tbody>{m.machines.map((x) => (
              <tr key={x.id} style={{ opacity: x.active ? 1 : 0.55 }}>
                <td><b>{x.name}</b><div className="dim" style={{ fontSize: 12 }}>{x.kind === "printing"
                  ? `Printing · ${x.colours ?? "?"} colour${x.colours === 1 ? "" : "s"}${x.cylinders ? ` · cylinders ${x.cylinders.split(",").join(", ")}″` : ""}`
                  : `Cutting · ${x.bag_types ? x.bag_types.split(",").map((k) => m.bagTypes.find((t) => t.key === k)?.name).join(", ") : "any bag"}`} · {x.per_day ?? "–"} rolls/day</div></td>
                <td><Status active={x.active} /></td><td className="num">{editBtn("machine", x)}</td></tr>))}
            </tbody></table>
          </Card>
        </div>
      </div>
      <div className="grid g-2" style={{ alignItems: "start" }}>
        <Card title="Clients" sub={`${m.clients.filter((c) => c.active).length} active`}>
          <p className="muted" style={{ margin: 0 }}>Clients now have their own page, with each client's order history.</p>
          <Link className="btn small" style={{ marginTop: 12 }} to="/clients">Go to Clients →</Link>
        </Card>
        <Card title="Suppliers" sub="Fabric suppliers" pad={false} action={addBtn("vendor")}>
          <table className="tbl"><tbody>{m.vendors.map((v) => (
            <tr key={v.id} style={{ opacity: v.active ? 1 : 0.55 }}><td><b>{v.name}</b><div className="dim" style={{ fontSize: 12 }}>{v.city}{v.phone ? ` · ${v.phone}` : ""}</div></td><td><Status active={v.active} /></td><td className="num">{editBtn("vendor", v)}</td></tr>))}
          </tbody></table>
        </Card>
      </div>

      <Dialog open={!!edit} title={form?.title(edit.v)} onClose={() => { setEdit(null); act.setError(null); }} onSubmit={save} busy={act.busy}>
        {form && <>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr 1fr" }}>
            {form.fields.filter(([, , o = {}]) => !(o.newOnly && edit.v.id)).map(([k, label, o = {}]) => (
              <Field key={k} label={label} className={o.span === 3 ? "span4" : o.span === 2 ? "span2" : ""}>
                <input className="input" type={o.type || "text"} step={o.step} required={o.required} value={edit.v[k] ?? ""} onChange={set(k)} />
              </Field>
            ))}
            {form.kind && <Field label="Type"><select className="input" disabled={!!edit.v.id} value={edit.v.kind} onChange={set("kind")}><option value="printing">Printing</option><option value="cutting">Cutting</option></select></Field>}
            {form.kind && edit.v.kind === "printing" && <>
              <Field label="Colours it can print"><input className="input" type="number" min="1" value={edit.v.colours ?? ""} onChange={set("colours")} /></Field>
              <Field label="Cylinders on hand (inches)" hint="e.g. 8, 10, 12 · blank = not tracked" className="span2"><input className="input" value={edit.v.cylinders ?? ""} onChange={set("cylinders")} /></Field>
            </>}
            {form.kind && edit.v.kind === "cutting" && <Field label="Bag types it can cut" hint="None ticked = any" className="span4">
              <div className="row wrap" style={{ gap: 14 }}>{m.bagTypes.map((t) => {
                const cur = (edit.v.bag_types || "").split(",").filter(Boolean);
                return <label key={t.key} className="row" style={{ gap: 6, fontSize: 13.5 }}><input type="checkbox" className="check" checked={cur.includes(t.key)}
                  onChange={(e) => setEdit({ ...edit, v: { ...edit.v, bag_types: (e.target.checked ? [...cur, t.key] : cur.filter((x) => x !== t.key)).join(",") } })} />{t.name}</label>;
              })}</div>
            </Field>}
            {form.quality && <Field label="Quality"><select className="input" value={edit.v.quality} onChange={set("quality")}><option>Standard</option><option>Premium</option></select></Field>}
          </div>
          {form.active && edit.v.id && <label className="row" style={{ fontSize: 13.5 }}><input type="checkbox" className="check" checked={edit.v.active} onChange={set("active")} /> Active (untick to hide from new entries; history is kept)</label>}
          {act.error && <ErrorBox error={act.error} />}
        </>}
      </Dialog>
    </div>
  );
}

// ── Users & roles ────────────────────────────────
function Users() {
  const { data, error, reload } = useData("/users");
  const { user: me } = useAuth();
  const act = useAction();
  const [edit, setEdit] = useState(null);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  const roleLabel = (k) => data.roles.find((r) => r.key === k)?.label;
  const set = (k) => (e) => setEdit({ ...edit, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const save = () => act.run(() => api(edit.id ? `/users/${edit.id}` : "/users", { name: edit.name, email: edit.email, role: edit.role, active: edit.active, password: edit.password || undefined }),
    edit.id ? "User updated" : "User created").then((r) => { if (r) { setEdit(null); reload(); } });

  return (
    <div className="grid g-2" style={{ alignItems: "start" }}>
      <Card title="People" sub="Everyone who can sign in" pad={false} action={<button className="btn small primary" onClick={() => setEdit({ role: "floor", active: true })}>Add user</button>}>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Name</th><th>Role</th><th>Last sign-in</th><th>Status</th><th /></tr></thead>
          <tbody>{data.users.map((u) => (
            <tr key={u.id} style={{ opacity: u.active ? 1 : 0.55 }}>
              <td><b>{u.name}</b>{u.id === me.id && <span className="dim"> (you)</span>}<div className="dim" style={{ fontSize: 12 }}>{u.email}</div></td>
              <td>{roleLabel(u.role)}</td>
              <td className="dim">{u.last_login ? ago(u.last_login) : "Never"}</td>
              <td>{!u.active ? <span className="pill plain">Deactivated</span> : u.must_change ? <span className="pill warn plain">Temporary password</span> : <span className="pill ok plain">Active</span>}</td>
              <td className="num"><button className="btn small" onClick={() => setEdit({ ...u, active: !!u.active, password: "" })}>Edit</button></td>
            </tr>))}
          </tbody>
        </table></div>
      </Card>
      <Card title="What each role can do">
        <dl className="roles">
          {data.roles.map((r) => <div key={r.key}><dt>{r.label}</dt><dd>{r.about}</dd></div>)}
        </dl>
        <p className="muted" style={{ fontSize: 12.5, margin: "14px 0 0" }}>Everyone signed in can view orders, production and stock. Prices are visible to owners and managers only.</p>
      </Card>

      <Dialog open={!!edit} title={edit?.id ? `Edit ${edit.name}` : "Add user"} onClose={() => { setEdit(null); act.setError(null); }} onSubmit={save} busy={act.busy}>
        {edit && <>
          <Field label="Name"><input className="input" required value={edit.name || ""} onChange={set("name")} /></Field>
          <Field label="Email (used to sign in)"><input className="input" type="email" required disabled={!!edit.id} value={edit.email || ""} onChange={set("email")} /></Field>
          <Field label="Role">
            <select className="input" value={edit.role} onChange={set("role")}>{data.roles.map((r) => <option key={r.key} value={r.key}>{r.label} · {r.about}</option>)}</select>
          </Field>
          <Field label={edit.id ? "Reset password (optional)" : "Temporary password"} hint="At least 10 characters. They'll be asked to choose their own at first sign-in.">
            <input className="input" type="text" autoComplete="off" required={!edit.id} minLength={10} value={edit.password || ""} onChange={set("password")} />
          </Field>
          {edit.id && <label className="row" style={{ fontSize: 13.5 }}><input type="checkbox" className="check" checked={edit.active} onChange={set("active")} /> Account is active (untick to block sign-in)</label>}
          {act.error && <ErrorBox error={act.error} />}
        </>}
      </Dialog>
    </div>
  );
}

// ── Company details (printed on challans) ───────
function Company() {
  const { data, reload } = useData("/company");
  const act = useAction();
  const [f, setF] = useState(null);
  if (!data) return null;
  const v = f || data;
  const set = (k) => (e) => setF({ ...v, [k]: e.target.value });
  const save = (e) => { e.preventDefault(); act.run(() => api("/company", v), "Company details saved").then((r) => { if (r) { setF(null); reload(); } }); };
  return (
    <Card title="Company details" sub="Printed at the top of every delivery challan">
      <form onSubmit={save} className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Field label="Business name" className="span2"><input className="input" value={v.name || ""} onChange={set("name")} /></Field>
        <Field label="Address" className="span2"><input className="input" value={v.address || ""} onChange={set("address")} /></Field>
        <Field label="Phone"><input className="input" value={v.phone || ""} onChange={set("phone")} /></Field>
        <Field label="GSTIN"><input className="input" value={v.gstin || ""} onChange={set("gstin")} /></Field>
        <Field label="HSN code for bags" hint="Shown on challans if filled. Confirm with your accountant"><input className="input" value={v.hsn || ""} onChange={set("hsn")} /></Field>
        <div style={{ alignSelf: "end" }}><button className="btn primary" disabled={act.busy || !f}>Save</button></div>
        {act.error && <div className="span2"><ErrorBox error={act.error} /></div>}
      </form>
    </Card>
  );
}

// ── Activity log ─────────────────────────────────
function Activity() {
  const { data, error } = useData("/activity");
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Loading />;
  return (
    <Card title="Activity log" sub="The last 100 changes, and who made them" pad={false}>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>When</th><th>What happened</th><th>By</th></tr></thead>
        <tbody>{data.map((a) => <tr key={a.id}><td className="dim" style={{ whiteSpace: "nowrap" }}>{ago(a.ts)}</td><td>{a.text}</td><td>{a.user || <span className="dim">System</span>}</td></tr>)}</tbody>
      </table></div>
    </Card>
  );
}

// ── My account ───────────────────────────────────
function Account() {
  const { user, logout } = useAuth();
  const toast = useToast();
  return (
    <div className="grid g-2e" style={{ alignItems: "start" }}>
      <Card title="Your account">
        <div className="facts" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="fact"><span>Name</span><b>{user.name}</b></div>
          <div className="fact"><span>Role</span><b>{user.roleLabel}</b></div>
          <div className="fact" style={{ gridColumn: "span 2" }}><span>Email</span><b>{user.email}</b></div>
        </div>
        <button className="btn" style={{ marginTop: 18 }} onClick={logout}>Sign out</button>
      </Card>
      <Card title="Change password" sub="You'll be signed out on your other devices">
        <PasswordForm onDone={() => toast("Password changed")} />
      </Card>
    </div>
  );
}

export default function Settings() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tabs = [
    { value: "reference", label: "Reference data" },
    can("users") && { value: "users", label: "Users & roles" },
    can("activity") && { value: "activity", label: "Activity log" },
    { value: "account", label: "My account" },
  ].filter(Boolean);
  const tab = tabs.some((t) => t.value === params.get("tab")) ? params.get("tab") : "reference";
  return (
    <>
      <PageHead eyebrow="Settings" title="Settings" />
      <div style={{ marginBottom: 20 }}><Segmented value={tab} onChange={(v) => setParams(v === "reference" ? {} : { tab: v })} options={tabs} /></div>
      {tab === "reference" && <Reference />}
      {tab === "users" && <div className="stack"><Users /><div className="grid g-2e"><Company /></div></div>}
      {tab === "activity" && <Activity />}
      {tab === "account" && <Account />}
    </>
  );
}
