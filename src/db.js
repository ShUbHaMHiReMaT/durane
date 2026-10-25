// D1 database: tables, starting data and small helpers.
// The tables are created automatically on first use, so the only setup is binding a D1 database as "DB".
import DATA from "./generated/data.json";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS companies (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'other',
    name TEXT NOT NULL, address TEXT DEFAULT '', gstin TEXT DEFAULT '', state TEXT DEFAULT '', state_code TEXT DEFAULT '',
    email TEXT DEFAULT '', phone TEXT DEFAULT '', pan TEXT DEFAULT '', bank_holder TEXT DEFAULT '', bank_name TEXT DEFAULT '',
    bank_account TEXT DEFAULT '', bank_ifsc TEXT DEFAULT '', bank_branch TEXT DEFAULT '', upi_id TEXT DEFAULT '',
    logo TEXT DEFAULT '', invoice_prefix TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    address TEXT DEFAULT '', gstin TEXT DEFAULT '', state TEXT DEFAULT '', state_code TEXT DEFAULT '', phone TEXT DEFAULT '',
    email TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT DEFAULT '',
    name TEXT NOT NULL UNIQUE COLLATE NOCASE, category TEXT DEFAULT '', hsn TEXT DEFAULT '40169310', unit TEXT DEFAULT 'unit',
    price_internal REAL, price_external REAL, price_other REAL, units_per_box INTEGER, mrp REAL, size TEXT DEFAULT '',
    rating TEXT DEFAULT '')`,
  `CREATE TABLE IF NOT EXISTS invoices (id INTEGER PRIMARY KEY AUTOINCREMENT, bill_type TEXT NOT NULL, price_list TEXT NOT NULL,
    invoice_no TEXT NOT NULL, date TEXT NOT NULL, company_id INTEGER, seller TEXT NOT NULL, buyer TEXT NOT NULL,
    tax_mode TEXT NOT NULL DEFAULT 'none', igst_rate REAL DEFAULT 0, cgst_rate REAL DEFAULT 0, sgst_rate REAL DEFAULT 0,
    qty_pct REAL DEFAULT 100, items TEXT NOT NULL, details TEXT DEFAULT '{}', subtotal REAL DEFAULT 0, tax_total REAL DEFAULT 0,
    round_off REAL DEFAULT 0, grand_total REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS enquiries (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL DEFAULT 'enquiry',
    name TEXT NOT NULL, company TEXT DEFAULT '', phone TEXT NOT NULL, email TEXT DEFAULT '', city TEXT DEFAULT '',
    products TEXT DEFAULT '', message TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'new', created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`,
  // uploaded files (e-Way Bill PDFs, company logos), kept in the database so no extra storage is needed
  `CREATE TABLE IF NOT EXISTS files (key TEXT PRIMARY KEY, type TEXT NOT NULL, data BLOB NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
  // wrong-password and form-spam counters per visitor address
  `CREATE TABLE IF NOT EXISTS hits (kind TEXT NOT NULL, ip TEXT NOT NULL, at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS hits_lookup ON hits (kind, ip, at)`,
  // every change made in billing, with a copy of the data before it changed (so even deleted bills can be recovered)
  `CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT DEFAULT CURRENT_TIMESTAMP,
    action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER, summary TEXT DEFAULT '', data TEXT DEFAULT '')`,
];

// tables included in a full backup (settings are filtered so login secrets never leave the database)
export const BACKUP_TABLES = ["companies", "clients", "products", "invoices", "enquiries", "settings", "activity"];
export const SECRET_SETTINGS = ["admin_password_hash", "session_secret", "auth_version", "admin_path"];

/** Records a change. `before` is the full row as it was (kept so it can be recovered). */
export function logActivity(env, action, entity, entityId, summary, before = null) {
  return env.DB.prepare("INSERT INTO activity (action, entity, entity_id, summary, data) VALUES (?, ?, ?, ?, ?)")
    .bind(action, entity, entityId ?? null, String(summary || "").slice(0, 300), before ? JSON.stringify(before) : "").run();
}

export const COMPANY_FIELDS = ["name", "address", "gstin", "state", "state_code", "email", "phone", "pan", "bank_holder",
  "bank_name", "bank_account", "bank_ifsc", "bank_branch", "upi_id", "invoice_prefix"];
export const CLIENT_FIELDS = ["name", "address", "gstin", "state", "state_code", "phone", "email"];
export const PRODUCT_FIELDS = ["code", "name", "category", "hsn", "unit", "price_internal", "price_external", "price_other",
  "units_per_box", "mrp", "size", "rating"];

let ready = null;

/** Creates the tables and starting data once per server instance. */
export function ensureDb(env) {
  if (!ready) ready = init(env.DB).catch(e => { ready = null; throw e; });
  return ready;
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function init(db) {
  await db.batch(SCHEMA.map(s => db.prepare(s)));
  const stmts = [];
  if (!(await db.prepare("SELECT COUNT(*) AS n FROM companies").first()).n) {
    for (const c of DATA.companies) stmts.push(insertStmt(db, "companies", c));
  }
  if (!(await db.prepare("SELECT COUNT(*) AS n FROM products").first()).n) {
    for (const p of DATA.products) stmts.push(insertStmt(db, "products", p));
  }
  const settings = { ...DATA.settings, session_secret: randomHex(32), auth_version: randomHex(8) };
  for (const [k, v] of Object.entries(settings)) {
    stmts.push(db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").bind(k, String(v)));
  }
  await db.batch(stmts);
}

export function insertStmt(db, table, obj) {
  const keys = Object.keys(obj);
  return db.prepare(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
    .bind(...keys.map(k => obj[k] ?? null));
}

export function updateStmt(db, table, obj, where, ...whereArgs) {
  const keys = Object.keys(obj);
  return db.prepare(`UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(",")} WHERE ${where}`)
    .bind(...keys.map(k => obj[k] ?? null), ...whereArgs);
}

export async function getSetting(env, key) {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key=?").bind(key).first();
  return r ? r.value : null;
}

export function setSetting(env, key, value) {
  return env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(key, String(value)).run();
}

export async function all(env, sql, ...args) {
  return (await env.DB.prepare(sql).bind(...args).all()).results;
}

export function first(env, sql, ...args) {
  return env.DB.prepare(sql).bind(...args).first();
}

export function run(env, sql, ...args) {
  return env.DB.prepare(sql).bind(...args).run();
}

export function parseInvoice(row) {
  const d = { ...row };
  for (const k of ["seller", "buyer", "items", "details"]) {
    try { d[k] = JSON.parse(d[k] || (k === "items" ? "[]" : "{}")); } catch { d[k] = k === "items" ? [] : {}; }
  }
  return d;
}

/** Keeps only the allowed fields, trimming text. */
export function clean(data, fields) {
  const out = {};
  for (const f of fields) {
    const v = data?.[f];
    out[f] = typeof v === "string" ? v.trim() : (v ?? null);
  }
  return out;
}

// ---- uploaded files
export async function putFile(env, key, type, bytes) {
  await env.DB.prepare("INSERT OR REPLACE INTO files (key, type, data) VALUES (?, ?, ?)").bind(key, type, bytes).run();
}

export async function getFile(env, key) {
  const r = await env.DB.prepare("SELECT type, data FROM files WHERE key=?").bind(key).first();
  return r ? { type: r.type, data: new Uint8Array(r.data) } : null;
}

export async function hasFile(env, key) {
  return !!(await env.DB.prepare("SELECT 1 AS x FROM files WHERE key=?").bind(key).first());
}

export function deleteFile(env, key) {
  return env.DB.prepare("DELETE FROM files WHERE key=?").bind(key).run();
}

// ---- rate counters (wrong passwords, form spam)
export async function countHits(env, kind, ip, windowSeconds) {
  const since = Math.floor(Date.now() / 1000) - windowSeconds;
  return (await first(env, "SELECT COUNT(*) AS n FROM hits WHERE kind=? AND ip=? AND at>?", kind, ip, since)).n;
}

export async function addHit(env, kind, ip) {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO hits (kind, ip, at) VALUES (?, ?, ?)").bind(kind, ip, now),
    env.DB.prepare("DELETE FROM hits WHERE at<?").bind(now - 86400),
  ]);
}

export function clearHits(env, kind, ip) {
  return run(env, "DELETE FROM hits WHERE kind=? AND ip=?", kind, ip);
}
