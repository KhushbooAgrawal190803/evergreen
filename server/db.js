import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const DB_PATH = process.env.DB_PATH || join(here, "..", "data", "evergreen.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, phone TEXT, agent TEXT
);
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT
);
CREATE TABLE IF NOT EXISTS machines (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('printing','cutting'))
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, order_no TEXT UNIQUE NOT NULL,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  bag_type TEXT NOT NULL CHECK (bag_type IN ('dcut','loop','box','ucut')),
  w REAL NOT NULL, l REAL NOT NULL, g REAL DEFAULT 0,
  gsm INTEGER NOT NULL, color TEXT NOT NULL, quality TEXT NOT NULL DEFAULT 'Standard',
  print_colors TEXT, loop_color TEXT,
  qty INTEGER NOT NULL CHECK (qty > 0), rate REAL,
  order_date TEXT NOT NULL, due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','delivered','cancelled')),
  delivered_on TEXT, notes TEXT
);
CREATE TABLE IF NOT EXISTS rolls (
  id INTEGER PRIMARY KEY, roll_no TEXT UNIQUE NOT NULL,
  vendor_id INTEGER REFERENCES vendors(id),
  color TEXT NOT NULL, size_in REAL NOT NULL, gsm INTEGER NOT NULL,
  quality TEXT NOT NULL DEFAULT 'Standard',
  length_m REAL NOT NULL, net_kg REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'transit' CHECK (status IN ('transit','stock','sold')),
  purchased_on TEXT, expected_on TEXT, received_on TEXT,
  order_id INTEGER REFERENCES orders(id),
  print_machine_id INTEGER REFERENCES machines(id), printed_on TEXT, print_kg REAL,
  cut_machine_id INTEGER REFERENCES machines(id), cut_on TEXT, bags_out INTEGER, waste_kg REAL
);
CREATE TABLE IF NOT EXISTS challans (
  id INTEGER PRIMARY KEY, challan_no TEXT UNIQUE NOT NULL, date TEXT NOT NULL,
  kind TEXT NOT NULL, vehicle TEXT, destination TEXT
);
CREATE TABLE IF NOT EXISTS sacks (
  id INTEGER PRIMARY KEY, sack_no TEXT UNIQUE NOT NULL,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  pieces INTEGER NOT NULL, kg REAL NOT NULL,
  -- Sacks are always created at the factory (by packing). Only a challan moves them.
  status TEXT NOT NULL DEFAULT 'factory' CHECK (status IN ('factory','godown','dispatched')),
  packed_on TEXT NOT NULL, challan_id INTEGER REFERENCES challans(id)
);
CREATE TABLE IF NOT EXISTS loops (
  id INTEGER PRIMARY KEY, color TEXT UNIQUE NOT NULL, balance_kg REAL NOT NULL DEFAULT 0, min_kg REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS roll_limits (
  id INTEGER PRIMARY KEY, color TEXT NOT NULL, size_in REAL NOT NULL, gsm INTEGER NOT NULL,
  quality TEXT NOT NULL, min_kg REAL NOT NULL,
  UNIQUE (color, size_in, gsm, quality)
);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY, ts TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  kind TEXT NOT NULL, text TEXT NOT NULL, user TEXT
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','manager','floor','dispatch')),
  password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), expires_at TEXT NOT NULL, user_agent TEXT
);
`);

// Columns added after the first release; existing databases get them here.
const addColumn = (table, col, def) => {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addColumn("activity", "user", "TEXT");
addColumn("machines", "active", "INTEGER NOT NULL DEFAULT 1");
addColumn("clients", "active", "INTEGER NOT NULL DEFAULT 1");
addColumn("vendors", "active", "INTEGER NOT NULL DEFAULT 1");
addColumn("vendors", "phone", "TEXT");
addColumn("rolls", "loop_kg", "REAL");                 // handle stock used when this roll was cut (restored on undo)
addColumn("sacks", "prev_status", "TEXT");             // where the sack was before its last move (for undo)
addColumn("sacks", "prev_challan_id", "INTEGER");
addColumn("challans", "cancelled_on", "TEXT");
addColumn("orders", "close_note", "TEXT");
// Machine capabilities drive the scheduling suggestions.
addColumn("machines", "colours", "INTEGER");           // printing: most colours it can print
addColumn("machines", "cylinders", "TEXT");            // printing: cylinder sizes on hand, e.g. "8,10,12" (blank = not tracked)
addColumn("machines", "bag_types", "TEXT");            // cutting: bag types it can cut, e.g. "dcut,loop" (blank = any)
addColumn("machines", "per_day", "INTEGER");           // rolls it can finish in a working day
// Delivery challan needs the consignee's details.
addColumn("clients", "address", "TEXT");
addColumn("clients", "gstin", "TEXT");
db.exec(`
CREATE TABLE IF NOT EXISTS challan_sacks (            -- what was on each challan, kept even if the sacks move again
  challan_id INTEGER NOT NULL REFERENCES challans(id), sack_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL, sack_no TEXT NOT NULL, pieces INTEGER NOT NULL, kg REAL NOT NULL,
  PRIMARY KEY (challan_id, sack_id)
);
CREATE TABLE IF NOT EXISTS company (key TEXT PRIMARY KEY, value TEXT);
`);

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec("BEGIN");
  try { const r = fn(); db.exec("COMMIT"); return r; }
  catch (e) { db.exec("ROLLBACK"); throw e; }
}

let actor = () => null;
/** auth.js registers who the current signed-in user is, so every log line records them. */
export const setActor = (fn) => { actor = fn; };
export function log(kind, text) {
  run("INSERT INTO activity (kind, text, user) VALUES (?, ?, ?)", kind, text, actor());
}

export const today = () => new Date().toLocaleDateString("en-CA");
export const addDays = (n, from = today()) => {
  const d = new Date(from + "T00:00:00"); d.setDate(d.getDate() + n);
  return d.toLocaleDateString("en-CA");
};
