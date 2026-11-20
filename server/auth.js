// Authentication & authorisation.
// - Passwords: scrypt with a per-user random salt (never stored or logged in plain text).
// - Sessions: random 256-bit token in an HttpOnly, SameSite=Lax cookie; only its SHA-256 is stored.
// - Lockout: 5 failed attempts for an email+IP pair locks sign-in for 15 minutes.
// - CSRF: state-changing requests must be same-origin JSON.
// - Roles: each role maps to a fixed list of permissions, checked on the server for every write.
import express from "express";
import { randomBytes, scryptSync, timingSafeEqual, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { all, one, run, tx, setActor } from "./db.js";

export const DEMO = process.env.DEMO !== "0";
const PROD = process.env.NODE_ENV === "production";
const COOKIE = "eg_session";
const SESSION_HOURS = 12;
const MAX_FAILS = 5, LOCK_MINUTES = 15;

export const ROLES = {
  owner: { label: "Owner", about: "Everything, including users", perms: ["orders", "pack", "stock", "production", "dispatch", "settings", "users", "money", "activity"] },
  manager: { label: "Manager", about: "Runs orders, stock, production and dispatch", perms: ["orders", "pack", "stock", "production", "dispatch", "settings", "money", "activity"] },
  floor: { label: "Floor operator", about: "Marks rolls printed / cut and packs bags", perms: ["production", "pack"] },
  dispatch: { label: "Dispatch", about: "Moves sacks and creates challans", perms: ["dispatch"] },
};
export const can = (user, perm) => !!user && ROLES[user.role]?.perms.includes(perm);

// ── Passwords ────────────────────────────────────
const N = 16384;
export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${N}$${salt.toString("hex")}$${scryptSync(pw, salt, 64, { N }).toString("hex")}`;
}
function verifyPassword(pw, stored) {
  const [, n, salt, hash] = stored.split("$");
  const want = Buffer.from(hash, "hex");
  const got = scryptSync(pw, Buffer.from(salt, "hex"), want.length, { N: Number(n) });
  return timingSafeEqual(want, got);
}
const DUMMY = hashPassword(randomBytes(8).toString("hex")); // keeps timing equal for unknown emails
export function passwordProblem(pw, email = "") {
  if (typeof pw !== "string" || pw.length < 10) return "Password must be at least 10 characters";
  if (pw.length > 200) return "Password is too long";
  if (email && pw.toLowerCase().includes(email.split("@")[0].toLowerCase())) return "Password can't contain your email name";
  if (/^(.)\1+$/.test(pw) || ["password12", "1234567890", "qwertyuiop"].includes(pw.toLowerCase())) return "Choose a less obvious password";
  return null;
}

// ── Sessions ─────────────────────────────────────
const sha = (s) => createHash("sha256").update(s).digest("hex");
function startSession(res, userId, ua) {
  const token = randomBytes(32).toString("base64url");
  run("INSERT INTO sessions (id, user_id, expires_at, user_agent) VALUES (?,?, datetime('now', ?), ?)", sha(token), userId, `+${SESSION_HOURS} hours`, (ua || "").slice(0, 200));
  res.setHeader("Set-Cookie", `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_HOURS * 3600}${PROD ? "; Secure" : ""}`);
}
const clearCookie = (res) => res.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${PROD ? "; Secure" : ""}`);
const readToken = (req) => (req.headers.cookie || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
function sessionUser(req) {
  const token = readToken(req);
  if (!token) return null;
  return one(`SELECT u.id, u.name, u.email, u.role, u.must_change FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.id = ? AND s.expires_at > datetime('now') AND u.active = 1`, sha(token)) || null;
}
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, roleLabel: ROLES[u.role].label, mustChange: !!u.must_change, perms: ROLES[u.role].perms });

// ── Lockout ──────────────────────────────────────
const fails = new Map(); // key → { count, until }
const failKey = (req, email) => `${req.ip}|${email}`;
function lockedFor(key) {
  const f = fails.get(key);
  if (!f) return 0;
  if (f.until && f.until > Date.now()) return Math.ceil((f.until - Date.now()) / 60000);
  if (f.until) fails.delete(key);
  return 0;
}
function recordFail(key) {
  const f = fails.get(key) || { count: 0 };
  f.count++;
  if (f.count >= MAX_FAILS) { f.until = Date.now() + LOCK_MINUTES * 60000; f.count = 0; }
  fails.set(key, f);
}

// ── Request context (who is acting) ──────────────
const ctx = new AsyncLocalStorage();
export const currentUser = () => ctx.getStore()?.user || null;
setActor(() => currentUser()?.name || null);

// ── Middleware ───────────────────────────────────
export function securityHeaders(_req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  if (PROD) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
  }
  next();
}

/** Reject cross-site writes: must be JSON and, when the browser sends Origin, it must be ours. */
export function sameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "Cross-site request blocked" });
  if (!req.is("application/json")) return res.status(415).json({ error: "Expected JSON" });
  next();
}

export function requireAuth(req, res, next) {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: "Please sign in" });
  req.user = user;
  // Until a temporary password is replaced, only the account endpoints work.
  if (user.must_change && !req.path.startsWith("/auth/")) return res.status(403).json({ error: "Change your password to continue" });
  ctx.run({ user }, next);
}

export const need = (perm) => (req, res, next) =>
  can(req.user, perm) ? next() : res.status(403).json({ error: "You don't have permission to do that" });

// ── Routes ───────────────────────────────────────
export const authPublic = express.Router();
export const authPrivate = express.Router();

authPublic.get("/auth/config", (_req, res) => {
  res.json({ demo: DEMO, demoAccounts: DEMO ? DEMO_USERS.map(([name, email, role]) => ({ name, email, role: ROLES[role].label, password: DEMO_PASSWORD })) : [] });
});

authPublic.post("/auth/login", (req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  const key = failKey(req, email);
  const mins = lockedFor(key);
  if (mins) return res.status(429).json({ error: `Too many attempts. Try again in ${mins} minute${mins > 1 ? "s" : ""}.` });
  const user = one("SELECT * FROM users WHERE email = ?", email);
  const ok = verifyPassword(password, user?.password_hash || DUMMY) && !!user && user.active === 1;
  if (!ok) {
    recordFail(key);
    return res.status(401).json({ error: "Email or password is incorrect" });
  }
  fails.delete(key);
  run("DELETE FROM sessions WHERE expires_at <= datetime('now')");
  run("UPDATE users SET last_login = datetime('now','localtime') WHERE id = ?", user.id);
  startSession(res, user.id, req.headers["user-agent"]);
  res.json({ user: publicUser(user) });
});

authPublic.get("/auth/me", (req, res) => {
  const user = sessionUser(req);
  if (!user) return res.status(401).json({ error: "Not signed in" });
  res.json({ user: publicUser(user) });
});

authPublic.post("/auth/logout", (req, res) => {
  const token = readToken(req);
  if (token) run("DELETE FROM sessions WHERE id = ?", sha(token));
  clearCookie(res);
  res.json({ ok: true });
});

authPrivate.post("/auth/password", (req, res) => {
  const u = one("SELECT * FROM users WHERE id = ?", req.user.id);
  if (!verifyPassword(String(req.body?.current || ""), u.password_hash)) return res.status(400).json({ error: "Current password is incorrect" });
  const next = req.body?.next;
  const problem = passwordProblem(next, u.email) || (next === req.body.current ? "New password must be different" : null);
  if (problem) return res.status(400).json({ error: problem });
  tx(() => {
    run("UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?", hashPassword(next), u.id);
    run("DELETE FROM sessions WHERE user_id = ?", u.id); // sign out everywhere…
  });
  startSession(res, u.id, req.headers["user-agent"]);   // …except here
  res.json({ ok: true });
});

authPrivate.get("/users", need("users"), (_req, res) => {
  res.json({
    users: all("SELECT id, name, email, role, active, must_change, last_login, created_at FROM users ORDER BY active DESC, name"),
    roles: Object.entries(ROLES).map(([key, r]) => ({ key, label: r.label, about: r.about })),
  });
});

const ownersLeft = (exceptId) => one("SELECT COUNT(*) n FROM users WHERE role = 'owner' AND active = 1 AND id != ?", exceptId).n;

authPrivate.post("/users", need("users"), (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim(), email = String(b.email || "").trim().toLowerCase();
  if (!name) return res.status(400).json({ error: "Name is required" });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email" });
  if (!ROLES[b.role]) return res.status(400).json({ error: "Choose a role" });
  const problem = passwordProblem(b.password, email);
  if (problem) return res.status(400).json({ error: problem });
  if (one("SELECT id FROM users WHERE email = ?", email)) return res.status(400).json({ error: "That email already has an account" });
  const id = run("INSERT INTO users (name, email, role, password_hash, must_change) VALUES (?,?,?,?,1)", name, email, b.role, hashPassword(b.password)).lastInsertRowid;
  res.json({ id });
});

authPrivate.post("/users/:id", need("users"), (req, res) => {
  const u = one("SELECT * FROM users WHERE id = ?", req.params.id);
  if (!u) return res.status(404).json({ error: "User not found" });
  const b = req.body || {};
  const role = b.role ?? u.role, active = b.active == null ? u.active : b.active ? 1 : 0;
  if (!ROLES[role]) return res.status(400).json({ error: "Choose a role" });
  if (u.role === "owner" && u.active && (role !== "owner" || !active) && ownersLeft(u.id) === 0) return res.status(400).json({ error: "There must be at least one active owner" });
  let hash = u.password_hash, mustChange = u.must_change;
  if (b.password) {
    const problem = passwordProblem(b.password, u.email);
    if (problem) return res.status(400).json({ error: problem });
    hash = hashPassword(b.password); mustChange = 1;
  }
  tx(() => {
    run("UPDATE users SET name = ?, role = ?, active = ?, password_hash = ?, must_change = ? WHERE id = ?", String(b.name || u.name).trim(), role, active, hash, mustChange, u.id);
    // Any change to access signs that person out so it takes effect immediately.
    if (b.password || !active || role !== u.role) run("DELETE FROM sessions WHERE user_id = ?", u.id);
  });
  res.json({ ok: true });
});

// ── First-run accounts ───────────────────────────
export const DEMO_PASSWORD = "evergreen-demo";
const DEMO_USERS = [
  ["Nikunj Poddar", "owner@evergreen.test", "owner"],
  ["Rohan Das", "manager@evergreen.test", "manager"],
  ["Imran Sheikh", "floor@evergreen.test", "floor"],
  ["Lata Roy", "dispatch@evergreen.test", "dispatch"],
];

export function ensureUsers() {
  if (one("SELECT COUNT(*) n FROM users").n > 0) return;
  if (DEMO) {
    DEMO_USERS.forEach(([name, email, role]) => run("INSERT INTO users (name, email, role, password_hash) VALUES (?,?,?,?)", name, email, role, hashPassword(DEMO_PASSWORD)));
    console.log(`Demo accounts created (password "${DEMO_PASSWORD}"): ${DEMO_USERS.map((u) => u[1]).join(", ")}`);
  } else {
    const email = (process.env.ADMIN_EMAIL || "owner@example.com").toLowerCase();
    const pw = randomBytes(12).toString("base64url");
    run("INSERT INTO users (name, email, role, password_hash, must_change) VALUES ('Owner', ?, 'owner', ?, 1)", email, hashPassword(pw));
    console.log(`\nFirst-run owner account: ${email}\nTemporary password (shown once): ${pw}\nYou'll be asked to change it at first sign-in.\n`);
  }
}
