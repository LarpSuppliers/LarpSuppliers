'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL,
  password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, ip TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, description TEXT DEFAULT '', sort INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
  description TEXT DEFAULT '', details TEXT DEFAULT '',
  price_cents INTEGER NOT NULL CHECK (price_cents >= 50), compare_at_cents INTEGER,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  images TEXT NOT NULL DEFAULT '[]',
  supplier_url TEXT DEFAULT '', supplier_cost_cents INTEGER NOT NULL DEFAULT 0, supplier_shipping_cents INTEGER NOT NULL DEFAULT 0,
  supplier_notes TEXT DEFAULT '',
  featured INTEGER DEFAULT 0, best_seller INTEGER DEFAULT 0, active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY, order_number TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'Awaiting Payment', payment_status TEXT NOT NULL DEFAULT 'unpaid',
  customer_name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT DEFAULT '',
  address1 TEXT NOT NULL, address2 TEXT DEFAULT '', city TEXT NOT NULL, state TEXT NOT NULL, zip TEXT NOT NULL, country TEXT NOT NULL DEFAULT 'US',
  subtotal_cents INTEGER NOT NULL, shipping_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
  amount_paid_cents INTEGER,
  stripe_session_id TEXT UNIQUE, stripe_payment_intent TEXT,
  processing_fee_cents INTEGER, fee_is_actual INTEGER DEFAULT 0,
  other_expenses_cents INTEGER NOT NULL DEFAULT 0, actual_supplier_cost_cents INTEGER,
  supplier_order_number TEXT DEFAULT '', tracking_number TEXT DEFAULT '', tracking_carrier TEXT DEFAULT '', tracking_url TEXT DEFAULT '',
  admin_notes TEXT DEFAULT '', confirmation_sent INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), paid_at TEXT, purchased_at TEXT, shipped_at TEXT, delivered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_email ON orders(email);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL, image TEXT DEFAULT '', unit_price_cents INTEGER NOT NULL, quantity INTEGER NOT NULL,
  supplier_url TEXT DEFAULT '', supplier_cost_cents INTEGER NOT NULL DEFAULT 0, supplier_shipping_cents INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  message TEXT NOT NULL, actor TEXT DEFAULT 'system', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, type TEXT, received_at TEXT DEFAULT (datetime('now')));

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, order_number TEXT DEFAULT '',
  subject TEXT DEFAULT '', body TEXT NOT NULL, is_read INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY, order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name TEXT NOT NULL, rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5), body TEXT NOT NULL,
  approved INTEGER DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Lightweight migrations for databases created by earlier versions.
const cols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
if (!cols('reviews').includes('source')) db.exec("ALTER TABLE reviews ADD COLUMN source TEXT NOT NULL DEFAULT 'order'");
if (!cols('products').includes('options')) db.exec("ALTER TABLE products ADD COLUMN options TEXT NOT NULL DEFAULT ''");
if (!cols('order_items').includes('options')) db.exec("ALTER TABLE order_items ADD COLUMN options TEXT NOT NULL DEFAULT ''");
if (!cols('categories').includes('image')) db.exec("ALTER TABLE categories ADD COLUMN image TEXT NOT NULL DEFAULT ''");

const DEFAULT_SETTINGS = {
  store_name: 'Larp Suppliers',
  tagline: 'Everything you want, all in one place.',
  support_email: 'support@example.com',
  shipping_flat_cents: '599',
  free_shipping_threshold_cents: '7500',
  fee_percent: '2.9',
  fee_fixed_cents: '30',
  processing_time: '1–3 business days',
  delivery_time: '5–10 business days',
  announcement: 'Free shipping on orders over $75 · New drops every week',
  business_address: '',
};
const insSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insSetting.run(k, v);

// Move stores created with the earlier fragrance-only defaults to the general-store defaults.
db.prepare("UPDATE settings SET value = ? WHERE key = 'tagline' AND value IN ('Signature fragrances for every occasion.', 'Considered essentials for everyday living.')").run(DEFAULT_SETTINGS.tagline);
db.prepare("UPDATE settings SET value = 'Larp Suppliers' WHERE key = 'store_name' AND value = 'Halcyon Goods'").run();

function getSettings() {
  const s = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) s[r.key] = r.value;
  return s;
}
function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

// Run fn inside a transaction (node:sqlite has no helper).
function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

// Convert null-prototype rows to plain objects.
const plain = (r) => (r ? { ...r } : r);
const one = (sql, ...a) => plain(db.prepare(sql).get(...a));
const all = (sql, ...a) => db.prepare(sql).all(...a).map(plain);
const run = (sql, ...a) => db.prepare(sql).run(...a);

module.exports = { db, getSettings, setSetting, tx, one, all, run };
