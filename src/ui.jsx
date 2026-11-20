import { useCallback, useEffect, useRef, useState, createContext, useContext } from "react";

// ── Data ─────────────────────────────────────────
export async function api(path, body) {
  const res = await fetch(`/api${path}`, body === undefined ? { credentials: "same-origin" } : {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("auth:expired"));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function useData(path, { refresh = 0 } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    api(path).then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => setState((s) => ({ ...s, error: e.message, loading: false })));
  }, [path]);
  useEffect(() => {
    load();
    if (!refresh) return;
    const t = setInterval(load, refresh);
    return () => clearInterval(t);
  }, [load, refresh]);
  return { ...state, reload: load };
}

// ── Formatting ───────────────────────────────────
export const n = (v) => Math.round(v ?? 0).toLocaleString("en-IN");
export const kg = (v) => `${n(v)} kg`;
export const dayName = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" });
export const dayNum = (iso) => new Date(iso + "T00:00:00").getDate();
export const dateShort = (iso) => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—";
export const dateLong = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
export const ago = (ts) => {
  const m = Math.round((Date.now() - new Date(ts.replace(" ", "T"))) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};
export const plural = (count, word, many = word + "s") => `${n(count)} ${count === 1 ? word : many}`;
export function dueText(days) {
  if (days < -1) return `${-days} days late`;
  if (days === -1) return "1 day late";
  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

// ── Small pieces ─────────────────────────────────
const STAGE_VAR = { fabric: "--s-fabric", printing: "--s-printing", cutting: "--s-cutting", packing: "--s-packing", ready: "--s-ready", delivered: "--good" };
/** Stage chip: the dot carries the stage colour (same as the dashboard bar); late orders add a red flag. */
export const StagePill = ({ o }) => (
  <span className="stage-pill">
    <span className="pill stage" style={{ "--dot": `var(${STAGE_VAR[o.stage]})` }}>{o.stageLabel}</span>
    {o.late && <span className="pill bad plain">Late</span>}
  </span>
);

export const Track = ({ o }) => (
  <div className={`track ${o.late ? "late" : ""}`} title={o.stageLabel}>
    {[0, 1, 2, 3, 4].map((i) => <i key={i} className={i < o.stageIdx || o.stage === "delivered" ? "on" : ""} />)}
  </div>
);

export const Card = ({ title, sub, action, children, pad = true, className = "" }) => (
  <section className={`card ${className}`}>
    {(title || action) && (
      <div className="card-h">
        <div><h2 className="card-t">{title}</h2>{sub && <div className="card-s">{sub}</div>}</div>
        {action}
      </div>
    )}
    <div className={pad ? "card-b" : ""}>{children}</div>
  </section>
);

export const Loading = () => <div className="empty">Loading…</div>;
export const ErrorBox = ({ error }) => <div className="error">{error}</div>;

export function PageHead({ eyebrow, title, children, actions }) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="title">{title}</h1>
        {children && <p className="lede">{children}</p>}
      </div>
      {actions && <div className="row wrap">{actions}</div>}
    </header>
  );
}

export function Segmented({ value, onChange, options }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.label}{o.count != null && <span className="c">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ── Dialog ───────────────────────────────────────
export function Dialog({ open, title, onClose, onSubmit, submitLabel = "Save", children, busy }) {
  const ref = useRef();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open && !d.open) d.showModal(); else if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onCancel={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>
        <div className="dlg-h">{title}</div>
        <div className="dlg-b">{children}</div>
        <div className="dlg-f">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {onSubmit && <button className="btn primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>}
        </div>
      </form>
    </dialog>
  );
}

export const Field = ({ label, hint, children, className = "" }) => (
  <div className={`field ${className}`}><label>{label}</label>{children}{hint && <div className="hint">{hint}</div>}</div>
);

// ── Toast ────────────────────────────────────────
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [msg, setMsg] = useState(null);
  const show = useCallback((m) => { setMsg(m); clearTimeout(show.t); show.t = setTimeout(() => setMsg(null), 2600); }, []);
  return <ToastCtx.Provider value={show}>{children}{msg && <div className="toast" role="status">{msg}</div>}</ToastCtx.Provider>;
}

/** Runs an action, toasts success, surfaces errors. */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const run = async (fn, success) => {
    setBusy(true); setError(null);
    try { const r = await fn(); if (success) toast(typeof success === "function" ? success(r) : success); return r; }
    catch (e) { setError(e.message); return undefined; }
    finally { setBusy(false); }
  };
  return { run, busy, error, setError };
}

// ── Confirm ──────────────────────────────────────
// const ok = await confirm({ title, body, confirmLabel, danger, reason: true }) → false | true | "reason text"
const ConfirmCtx = createContext(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }) {
  const [req, setReq] = useState(null);
  const [reason, setReason] = useState("");
  const ask = useCallback((opts) => new Promise((resolve) => { setReason(""); setReq({ ...opts, resolve }); }), []);
  const close = (v) => { req?.resolve(v); setReq(null); };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      <Dialog open={!!req} title={req?.title} onClose={() => close(false)} onSubmit={() => close(req.reason ? reason.trim() || false : true)} submitLabel={req?.confirmLabel || "Confirm"}>
        {req?.body && <div style={{ color: "var(--ink-2)" }}>{req.body}</div>}
        {req?.reason && <Field label={typeof req.reason === "string" ? req.reason : "Reason"}><input className="input" required autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

/** Run an undo-style action: confirm, call, toast, reload. */
export function useUndo(reload) {
  const confirm = useConfirm();
  const toast = useToast();
  const [error, setError] = useState(null);
  const run = async (opts, path, body = {}) => {
    const ans = await confirm(opts);
    if (!ans) return false;
    try {
      await api(path, typeof ans === "string" ? { ...body, reason: ans, note: ans } : body);
      toast(opts.done || "Done"); setError(null); reload?.(); return true;
    } catch (e) { setError(e.message); return false; }
  };
  return { run, error, setError };
}
