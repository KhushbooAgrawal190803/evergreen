import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, Field, ErrorBox } from "./ui.jsx";

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ user: null, ready: false });
  const refresh = useCallback(() => api("/auth/me").then((r) => setState({ user: r.user, ready: true })).catch(() => setState({ user: null, ready: true })), []);
  useEffect(() => {
    refresh();
    // Any request that comes back "not signed in" (expired session) drops us to the sign-in screen.
    const out = () => setState({ user: null, ready: true });
    window.addEventListener("auth:expired", out);
    return () => window.removeEventListener("auth:expired", out);
  }, [refresh]);

  const value = {
    user: state.user,
    can: (perm) => !!state.user?.perms.includes(perm),
    login: async (email, password) => { const r = await api("/auth/login", { email, password }); setState({ user: r.user, ready: true }); },
    logout: async () => { await api("/auth/logout", {}).catch(() => {}); setState({ user: null, ready: true }); },
    refresh,
  };
  if (!state.ready) return null;
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

const Mark = () => (
  <div className="brand" style={{ padding: 0, justifyContent: "center" }}>
    <div className="brand-mark"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M16 4l8 12h-5l6 10H7l6-10H8z" fill="#F5F3EE" /></svg></div>
    <div><div className="brand-name">Evergreen</div></div>
  </div>
);

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cfg, setCfg] = useState(null);
  useEffect(() => { api("/auth/config").then(setCfg).catch(() => {}); }, []);

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try { await login(email, password); } catch (err) { setError(err.message); setPassword(""); } finally { setBusy(false); }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <Mark />
        <h1 className="auth-title">Sign in</h1>
        <Field label="Email">
          <input className="input" type="email" autoComplete="username" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password">
          <div className="pw">
            <input className="input" type={show ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>{show ? "Hide" : "Show"}</button>
          </div>
        </Field>
        {error && <ErrorBox error={error} />}
        <button className="btn primary auth-btn" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="auth-foot">Forgot your password? Ask the owner to reset it.</p>
      </form>

      {cfg?.demo && (
        <div className="auth-demo">
          <div className="sub-h">Demo accounts · click to fill</div>
          {cfg.demoAccounts.map((a) => (
            <button key={a.email} type="button" onClick={() => { setEmail(a.email); setPassword(a.password); setError(null); }}>
              <b>{a.role}</b><span>{a.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function PasswordForm({ onDone, submitLabel = "Change password" }) {
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setError(null);
    if (f.next !== f.again) return setError("The two new passwords don't match");
    setBusy(true);
    try { await api("/auth/password", { current: f.current, next: f.next }); setF({ current: "", next: "", again: "" }); onDone?.(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
      <Field label="Current password"><input className="input" type="password" autoComplete="current-password" required value={f.current} onChange={set("current")} /></Field>
      <Field label="New password" hint="At least 10 characters"><input className="input" type="password" autoComplete="new-password" required minLength={10} value={f.next} onChange={set("next")} /></Field>
      <Field label="New password again"><input className="input" type="password" autoComplete="new-password" required value={f.again} onChange={set("again")} /></Field>
      {error && <ErrorBox error={error} />}
      <div><button className="btn primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button></div>
    </form>
  );
}

/** Shown instead of the app while a temporary (admin-set) password is still in place. */
export function ForcePassword() {
  const { user, refresh, logout } = useAuth();
  return (
    <div className="auth-page">
      <div className="auth-card">
        <Mark />
        <h1 className="auth-title">Set your password</h1>
        <p className="muted" style={{ margin: 0 }}>Hi {user.name.split(" ")[0]}. Your password was set by an admin, so choose your own before continuing.</p>
        <PasswordForm onDone={refresh} submitLabel="Save and continue" />
        <button className="link-btn" onClick={logout}>Sign out</button>
      </div>
    </div>
  );
}
