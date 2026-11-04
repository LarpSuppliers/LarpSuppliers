'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../lib/config');
const { one, all, run, tx, getSettings, setSetting } = require('../lib/db');
const { readBody, parseForm, parseMultipart, rateLimiter } = require('../lib/http');
const auth = require('../lib/auth');
const { toCents, slugify, safeUrl, clip, isEmail } = require('../lib/util');
const orders = require('../lib/orders');
const opt = require('../lib/options');
const stripe = require('../lib/stripe');
const email = require('../lib/email');
const V = require('../views/admin');

const loginLimit = rateLimiter({ windowMs: 15 * 60_000, max: 10 });
const MAX_IMAGES = 8;

// ---------- helpers ----------
function setFlash(res, msg, type = 'ok') { res.setCookie('flash', JSON.stringify({ msg, type }), { httpOnly: true, sameSite: 'Strict', maxAge: 30, path: '/admin' }); }
function takeFlash(req, res) {
  if (!req.cookies.flash) return null;
  res.setCookie('flash', '', { maxAge: 0, path: '/admin', sameSite: 'Strict' });
  try { return JSON.parse(req.cookies.flash); } catch { return null; }
}

async function requireAdmin(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  req.session = auth.loadSession(req);
  if (!req.session) {
    if (req.method === 'GET') return res.redirect('/admin/login');
    return res.html('Session expired. Please <a href="/admin/login">log in again</a>.', 401);
  }
  if (req.method === 'POST') {
    const type = req.headers['content-type'] || '';
    const buf = await readBody(req, type.startsWith('multipart/') ? 26 * 1024 * 1024 : 200_000);
    if (type.startsWith('multipart/')) { const mp = parseMultipart(buf, type); req.body = mp.fields; req.files = mp.files; } else { req.body = parseForm(buf); req.files = []; }
    if (!auth.checkCsrf(req, req.body)) return res.html('Security check failed (invalid form token). Go back, refresh the page and try again.', 403);
  }
}

const ctx = (req, res, extra = {}) => ({ session: req.session, settings: getSettings(), flash: takeFlash(req, res), ...extra });

function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return '.jpg';
  if (buf.length > 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (buf.length > 12 && buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return '.webp';
  if (buf.length > 6 && /^GIF8[79]a$/.test(buf.slice(0, 6).toString())) return '.gif';
  return null;
}

function saveUploads(files, field = 'images') {
  const saved = []; const errors = [];
  for (const f of files.filter((x) => x.field === field)) {
    const ext = sniffImage(f.data);
    if (!ext) { errors.push(`${f.filename}: not a JPG/PNG/WEBP/GIF image`); continue; }
    if (f.data.length > 5 * 1024 * 1024) { errors.push(`${f.filename}: larger than 5 MB`); continue; }
    const name = crypto.randomBytes(12).toString('hex') + ext;
    fs.writeFileSync(path.join(config.uploadsDir, name), f.data);
    saved.push('/uploads/' + name);
  }
  return { saved, errors };
}

function deleteUploadIfUnused(url) {
  if (!url.startsWith('/uploads/')) return;
  if (one('SELECT 1 AS x FROM order_items WHERE image = ?', url) || one('SELECT 1 AS x FROM products WHERE images LIKE ?', `%${url}%`) || one('SELECT 1 AS x FROM categories WHERE image = ?', url)) return;
  const file = path.join(config.uploadsDir, path.basename(url));
  fs.rm(file, { force: true }, () => {});
}

function uniqueSlug(base, exceptId = 0) {
  let slug = slugify(base); let n = 2;
  while (one('SELECT 1 AS x FROM products WHERE slug = ? AND id <> ?', slug, exceptId)) slug = `${slugify(base)}-${n++}`;
  return slug;
}

const TRACKING_URLS = {
  usps: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=', ups: 'https://www.ups.com/track?tracknum=',
  fedex: 'https://www.fedex.com/fedextrack/?trknbr=', dhl: 'https://www.dhl.com/us-en/home/tracking/tracking-express.html?tracking-id=',
};
const trackingUrlFor = (carrier, number) => (TRACKING_URLS[String(carrier).toLowerCase().trim()] || 'https://t.17track.net/en#nums=') + encodeURIComponent(number);

function withFinancials(list) { return list.map((o) => ({ ...o, fin: orders.financials(o) })); }

function computeStats() {
  const paid = all("SELECT * FROM orders WHERE payment_status IN ('paid', 'refunded') ORDER BY paid_at");
  const stats = { revenue: 0, profit: 0, supplier: 0, fees: 0, units: 0, orders: 0, pending: 0, completed: 0 };
  const byDay = new Map(); const byProduct = new Map();
  for (const o of paid) {
    const items = orders.getItems(o.id); const f = orders.financials(o, items);
    stats.profit += f.profit; stats.supplier += f.supplierTotal; stats.fees += f.fee;
    if (o.status === 'Refunded') continue;
    stats.revenue += f.revenue; stats.orders++;
    stats.units += items.reduce((a, i) => a + i.quantity, 0);
    if (['Paid', 'Awaiting Purchase', 'Purchased', 'Shipped'].includes(o.status)) stats.pending++;
    if (o.status === 'Delivered') stats.completed++;
    const day = String(o.paid_at || o.created_at).slice(0, 10);
    const d = byDay.get(day) || { revenue: 0, orders: 0 }; d.revenue += f.revenue; d.orders++; byDay.set(day, d);
    for (const i of f.items) {
      const k = i.product_id || i.name; const t = byProduct.get(k) || { name: i.name, units: 0, revenue: 0, profit: 0 };
      t.units += i.quantity; t.revenue += i.unit_price_cents * i.quantity; t.profit += i.lineProfit; byProduct.set(k, t);
    }
  }
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 864e5); const key = dt.toISOString().slice(0, 10);
    const d = byDay.get(key) || { revenue: 0, orders: 0 };
    days.push({ ...d, label: dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }), short: dt.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' }) });
  }
  const top = [...byProduct.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 6);
  return { stats, days, top };
}

module.exports = (r) => {
  // ---------- auth ----------
  r.get('/admin/login', (req, res) => {
    if (auth.loadSession(req)) return res.redirect('/admin');
    res.setHeader('Cache-Control', 'no-store');
    res.html(V.login({ settings: getSettings() }));
  });
  r.post('/admin/login', async (req, res) => {
    const f = parseForm(await readBody(req, 10_000));
    if (!loginLimit(req.ip)) return res.html(V.login({ settings: getSettings(), error: 'Too many login attempts. Try again in 15 minutes.' }), 429);
    const admin = auth.login(f.email, f.password);
    if (!admin) return res.html(V.login({ settings: getSettings(), error: 'Incorrect email or password.' }), 401);
    auth.createSession(res, admin.id, req.ip);
    res.redirect('/admin');
  });
  r.post('/admin/logout', requireAdmin, (req, res) => { auth.destroySession(req, res); res.redirect('/admin/login'); });

  // ---------- dashboard ----------
  r.get('/admin', requireAdmin, (req, res) => {
    const { stats, days, top } = computeStats();
    res.html(V.dashboard(ctx(req, res, {
      stats, days, top, stripeReady: stripe.isConfigured(), testMode: stripe.isTestMode(),
      queue: all("SELECT id FROM orders WHERE status = 'Awaiting Purchase' AND payment_status = 'paid'"),
      recent: withFinancials(all("SELECT * FROM orders WHERE payment_status <> 'unpaid' ORDER BY created_at DESC LIMIT 8")),
      unread: one('SELECT COUNT(*) AS n FROM messages WHERE is_read = 0').n,
    })));
  });

  // ---------- orders ----------
  r.get('/admin/orders', requireAdmin, (req, res) => {
    const status = orders.STATUSES.includes(req.query.status) ? req.query.status : '';
    const q = clip(req.query.q, 100);
    let sql = 'SELECT o.*, (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) AS item_count FROM orders o WHERE 1=1'; const args = [];
    if (status) { sql += ' AND o.status = ?'; args.push(status); }
    if (q) { sql += ' AND (o.order_number LIKE ? OR o.customer_name LIKE ? OR o.email LIKE ?)'; const l = `%${q}%`; args.push(l, l, l); }
    sql += status === 'Awaiting Purchase' ? ' ORDER BY o.paid_at ASC' : ' ORDER BY o.created_at DESC';
    sql += ' LIMIT 500';
    const counts = { _all: one('SELECT COUNT(*) AS n FROM orders').n };
    for (const row of all('SELECT status, COUNT(*) AS n FROM orders GROUP BY status')) counts[row.status] = row.n;
    res.html(V.ordersList(ctx(req, res, { orders: withFinancials(all(sql, ...args)), status, q, counts })));
  });

  r.get('/admin/orders/:id', requireAdmin, (req, res) => {
    const o = orders.getOrder(Number(req.params.id));
    if (!o) return res.redirect('/admin/orders');
    const items = orders.getItems(o.id).map((i) => ({ ...i, supplier_notes: i.product_id ? one('SELECT supplier_notes FROM products WHERE id = ?', i.product_id)?.supplier_notes || '' : '' }));
    const fin = orders.financials(o, items);
    fin.items = fin.items.map((fi, idx) => ({ ...fi, supplier_notes: items[idx].supplier_notes }));
    res.html(V.orderDetail(ctx(req, res, { order: o, items, fin, events: all('SELECT * FROM order_events WHERE order_id = ? ORDER BY id DESC', o.id), stripeReady: stripe.isConfigured() })));
  });

  r.post('/admin/orders/:id/action', requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const o = orders.getOrder(id);
    if (!o) return res.redirect('/admin/orders');
    const f = req.body; const who = req.session.name; const back = `/admin/orders/${id}`;
    const fail = (msg) => { setFlash(res, msg, 'error'); res.redirect(back); };
    const paid = o.payment_status === 'paid';

    switch (f.action) {
      case 'mark_purchased': {
        if (f.confirm !== 'yes') return fail('Please tick the confirmation box to confirm you purchased the product from the supplier.');
        if (!paid || !['Paid', 'Awaiting Purchase'].includes(o.status)) return fail('Only paid orders awaiting purchase can be marked as purchased.');
        const actual = toCents(f.actual_supplier_cost);
        const son = clip(f.supplier_order_number, 100);
        run(`UPDATE orders SET status = 'Purchased', purchased_at = datetime('now'), updated_at = datetime('now'),
             supplier_order_number = CASE WHEN ? <> '' THEN ? ELSE supplier_order_number END,
             actual_supplier_cost_cents = COALESCE(?, actual_supplier_cost_cents) WHERE id = ?`, son, son, actual, id);
        orders.logEvent(id, `Manually confirmed as purchased from supplier${son ? ` (supplier order #${son})` : ''}${actual !== null ? `, paid $${(actual / 100).toFixed(2)}` : ''}.`, who);
        setFlash(res, 'Marked as purchased. Next: add the tracking number when the supplier provides it.');
        return res.redirect(back);
      }
      case 'save_supplier_order': {
        const son = clip(f.supplier_order_number, 100);
        run("UPDATE orders SET supplier_order_number = ?, updated_at = datetime('now') WHERE id = ?", son, id);
        orders.logEvent(id, son ? `Supplier order number set to ${son}.` : 'Supplier order number cleared.', who);
        setFlash(res, 'Supplier order number saved.'); return res.redirect(back);
      }
      case 'save_tracking': {
        const num = clip(f.tracking_number, 100).replace(/\s+/g, ''); const carrier = clip(f.tracking_carrier, 60);
        let url = safeUrl(f.tracking_url);
        if (!url && num) url = trackingUrlFor(carrier, num);
        run("UPDATE orders SET tracking_number = ?, tracking_carrier = ?, tracking_url = ?, updated_at = datetime('now') WHERE id = ?", num, carrier, num ? url : '', id);
        orders.logEvent(id, num ? `Tracking added: ${carrier || 'carrier'} ${num}.` : 'Tracking removed.', who);
        setFlash(res, num ? 'Tracking saved. Mark the order as shipped to notify the customer.' : 'Tracking removed.'); return res.redirect(back);
      }
      case 'mark_shipped': {
        if (o.status !== 'Purchased') return fail('Only orders marked “Purchased” can be marked as shipped.');
        run("UPDATE orders SET status = 'Shipped', shipped_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", id);
        orders.logEvent(id, 'Marked as shipped.', who);
        let msg = 'Marked as shipped.';
        if (f.notify === '1') {
          try { await email.shippingUpdate(orders.getOrder(id)); orders.logEvent(id, 'Shipping email sent to customer.'); msg += ' Customer notified by email.'; }
          catch (e) { orders.logEvent(id, `Shipping email failed: ${e.message}`); msg += ' (Email failed — see timeline.)'; }
        }
        if (!o.tracking_number) msg += ' Note: no tracking number was added.';
        setFlash(res, msg, o.tracking_number ? 'ok' : 'warn'); return res.redirect(back);
      }
      case 'mark_delivered': {
        if (o.status !== 'Shipped') return fail('Only shipped orders can be marked as delivered.');
        run("UPDATE orders SET status = 'Delivered', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", id);
        orders.logEvent(id, 'Marked as delivered.', who);
        setFlash(res, 'Marked as delivered. 🎉'); return res.redirect(back);
      }
      case 'cancel': {
        if (!['Awaiting Payment', 'Paid', 'Awaiting Purchase'].includes(o.status)) return fail('This order can no longer be cancelled here. Use a refund instead.');
        run("UPDATE orders SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?", id);
        orders.logEvent(id, 'Order cancelled.', who);
        if (!paid && o.stripe_session_id && stripe.isConfigured()) { try { await stripe.expireSession(o.stripe_session_id); } catch { /* already expired/complete */ } }
        setFlash(res, paid ? 'Order cancelled. The customer has paid — issue a refund so they get their money back.' : 'Order cancelled.', paid ? 'warn' : 'ok');
        return res.redirect(back);
      }
      case 'refund': {
        if (!paid || !o.stripe_payment_intent) return fail('This order has no completed payment to refund.');
        try {
          const rf = await stripe.createRefund(o.stripe_payment_intent, o.order_number);
          run("UPDATE orders SET status = 'Refunded', payment_status = 'refunded', updated_at = datetime('now') WHERE id = ?", id);
          orders.logEvent(id, `Full refund issued via Stripe (${rf.id}, status: ${rf.status}).`, who);
          setFlash(res, 'Refund issued. The customer will see it in 5–10 business days.');
        } catch (e) { orders.logEvent(id, `Refund failed: ${e.message}`, who); return fail(`Refund failed: ${e.message}`); }
        return res.redirect(back);
      }
      case 'set_status': {
        const to = f.status;
        if (to === o.status) return res.redirect(back);
        const allowed = ['Awaiting Purchase', 'Shipped', 'Delivered', 'Cancelled', 'Refunded'];
        if (!allowed.includes(to)) return fail('That status can only be set automatically (Paid) or through its confirmation step (Purchased).');
        if (to === 'Awaiting Purchase' && !paid) return fail('Only paid orders can be awaiting purchase.');
        if (['Shipped', 'Delivered'].includes(to) && !o.purchased_at) return fail('Mark the order as Purchased (with confirmation) before it can be shipped or delivered.');
        run(`UPDATE orders SET status = ?, updated_at = datetime('now'),
             shipped_at = CASE WHEN ? IN ('Shipped','Delivered') THEN COALESCE(shipped_at, datetime('now')) ELSE shipped_at END,
             delivered_at = CASE WHEN ? = 'Delivered' THEN COALESCE(delivered_at, datetime('now')) ELSE delivered_at END,
             payment_status = CASE WHEN ? = 'Refunded' AND payment_status = 'paid' THEN 'refunded' ELSE payment_status END WHERE id = ?`, to, to, to, to, id);
        orders.logEvent(id, `Status manually changed from “${o.status}” to “${to}”.${to === 'Refunded' ? ' (Make sure the refund was actually issued in Stripe.)' : ''}`, who);
        setFlash(res, `Status set to ${to}.`); return res.redirect(back);
      }
      case 'save_costs': {
        const other = toCents(f.other_expenses) ?? 0;
        const actual = String(f.actual_supplier_cost || '').trim() === '' ? null : toCents(f.actual_supplier_cost);
        if (String(f.actual_supplier_cost || '').trim() !== '' && actual === null) return fail('Invalid supplier amount.');
        run("UPDATE orders SET other_expenses_cents = ?, actual_supplier_cost_cents = ?, updated_at = datetime('now') WHERE id = ?", other, actual, id);
        orders.logEvent(id, 'Cost figures updated.', who);
        setFlash(res, 'Costs updated.'); return res.redirect(back);
      }
      case 'save_notes': {
        run("UPDATE orders SET admin_notes = ?, updated_at = datetime('now') WHERE id = ?", clip(f.admin_notes, 4000), id);
        setFlash(res, 'Notes saved.'); return res.redirect(back);
      }
      default: return fail('Unknown action.');
    }
  });

  // ---------- products ----------
  r.get('/admin/products', requireAdmin, (req, res) => {
    const q = clip(req.query.q, 100);
    const products = all(`SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id
      ${q ? 'WHERE p.name LIKE ?' : ''} ORDER BY p.active DESC, p.updated_at DESC`, ...(q ? [`%${q}%`] : []));
    res.html(V.productsList(ctx(req, res, { products, q })));
  });

  const cats = () => all('SELECT * FROM categories ORDER BY sort, name');

  function validateProduct(f) {
    const errors = {};
    const v = {
      name: clip(f.name, 140), description: clip(f.description, 2000), details: clip(f.details, 4000),
      price_cents: toCents(f.price), compare_at_cents: toCents(f.compare_at),
      category_id: one('SELECT id FROM categories WHERE id = ?', Number(f.category_id) || 0)?.id ?? null,
      supplier_url: '', supplier_cost_cents: toCents(f.supplier_cost) ?? 0, supplier_shipping_cents: toCents(f.supplier_shipping) ?? 0,
      supplier_notes: clip(f.supplier_notes, 2000), options: opt.formatOptionsText(opt.parseOptions(f.options)),
      active: f.active === '1' ? 1 : 0, featured: f.featured === '1' ? 1 : 0, best_seller: f.best_seller === '1' ? 1 : 0,
    };
    if (v.name.length < 2) errors.name = 'Name is required.';
    if (String(f.options || '').trim() && !v.options) { errors.options = 'Write options like “Size: S, M, L” (name, colon, comma-separated choices).'; v.options = clip(f.options, 2000); }
    if (v.price_cents === null || v.price_cents < 50) errors.price = 'Enter a price of at least $0.50.';
    if (f.compare_at && v.compare_at_cents === null) errors.compare_at = 'Invalid amount.';
    if (v.compare_at_cents !== null && v.price_cents !== null && v.compare_at_cents <= v.price_cents) v.compare_at_cents = null;
    if (f.supplier_cost && toCents(f.supplier_cost) === null) errors.supplier_cost = 'Invalid amount.';
    if (f.supplier_shipping && toCents(f.supplier_shipping) === null) errors.supplier_shipping = 'Invalid amount.';
    if (String(f.supplier_url || '').trim()) { v.supplier_url = safeUrl(f.supplier_url); if (!v.supplier_url) errors.supplier_url = 'Enter a full URL starting with https://'; }
    return { v, errors };
  }

  r.get('/admin/products/new', requireAdmin, (req, res) => res.html(V.productForm(ctx(req, res, { categories: cats() }))));
  r.post('/admin/products/new', requireAdmin, (req, res) => {
    const { v, errors } = validateProduct(req.body);
    if (Object.keys(errors).length) return res.html(V.productForm(ctx(req, res, { categories: cats(), errors, p: { ...v, images: '[]' } })), 400);
    const up = saveUploads(req.files);
    const imgs = up.saved.slice(0, MAX_IMAGES);
    const needsPhoto = v.active && !imgs.length;
    if (needsPhoto) v.active = 0;
    const rr = run(`INSERT INTO products (name, slug, description, details, options, price_cents, compare_at_cents, category_id, images, supplier_url, supplier_cost_cents, supplier_shipping_cents, supplier_notes, active, featured, best_seller)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, v.name, uniqueSlug(v.name), v.description, v.details, v.options, v.price_cents, v.compare_at_cents, v.category_id,
      JSON.stringify(imgs), v.supplier_url, v.supplier_cost_cents, v.supplier_shipping_cents, v.supplier_notes, v.active, v.featured, v.best_seller);
    const notes = [up.errors.length ? `Some images were skipped: ${up.errors.join('; ')}` : '', needsPhoto ? 'Saved as a draft because it has no photo yet. Add a photo, then tick Active.' : ''].filter(Boolean);
    setFlash(res, notes.length ? `Product created. ${notes.join(' ')}` : 'Product created.', notes.length ? 'warn' : 'ok');
    res.redirect(`/admin/products/${rr.lastInsertRowid}`);
  });

  r.get('/admin/products/:id', requireAdmin, (req, res) => {
    const p = one('SELECT * FROM products WHERE id = ?', Number(req.params.id));
    if (!p) return res.redirect('/admin/products');
    res.html(V.productForm(ctx(req, res, { p, categories: cats() })));
  });
  r.post('/admin/products/:id', requireAdmin, (req, res) => {
    const p = one('SELECT * FROM products WHERE id = ?', Number(req.params.id));
    if (!p) return res.redirect('/admin/products');
    const { v, errors } = validateProduct(req.body);
    if (Object.keys(errors).length) return res.html(V.productForm(ctx(req, res, { categories: cats(), errors, p: { ...p, ...v, price_cents: v.price_cents ?? p.price_cents } })), 400);
    let images = []; try { images = JSON.parse(p.images); } catch { /* none */ }
    const remove = new Set([].concat(req.body.remove_images || []));
    images = images.filter((im) => !remove.has(im));
    if (req.body.main_image && images.includes(req.body.main_image)) images = [req.body.main_image, ...images.filter((im) => im !== req.body.main_image)];
    const up = saveUploads(req.files);
    images = [...images, ...up.saved].slice(0, MAX_IMAGES);
    const needsPhoto = v.active && !images.length;
    if (needsPhoto) v.active = 0;
    run(`UPDATE products SET name = ?, slug = ?, description = ?, details = ?, options = ?, price_cents = ?, compare_at_cents = ?, category_id = ?, images = ?, supplier_url = ?,
      supplier_cost_cents = ?, supplier_shipping_cents = ?, supplier_notes = ?, active = ?, featured = ?, best_seller = ?, updated_at = datetime('now') WHERE id = ?`,
    v.name, p.name === v.name ? p.slug : uniqueSlug(v.name, p.id), v.description, v.details, v.options, v.price_cents, v.compare_at_cents, v.category_id, JSON.stringify(images),
    v.supplier_url, v.supplier_cost_cents, v.supplier_shipping_cents, v.supplier_notes, v.active, v.featured, v.best_seller, p.id);
    for (const im of remove) deleteUploadIfUnused(im);
    const notes = [up.errors.length ? `Some images were skipped: ${up.errors.join('; ')}` : '', needsPhoto ? 'Kept as a draft because it has no photo. Add a photo, then tick Active.' : ''].filter(Boolean);
    setFlash(res, notes.length ? `Saved. ${notes.join(' ')}` : (v.active ? 'Product saved — it is live in the store.' : 'Product saved as a draft.'), notes.length ? 'warn' : 'ok');
    res.redirect(`/admin/products/${p.id}`);
  });
  r.post('/admin/products/:id/delete', requireAdmin, (req, res) => {
    const p = one('SELECT * FROM products WHERE id = ?', Number(req.params.id));
    if (p) {
      run('DELETE FROM products WHERE id = ?', p.id);
      try { for (const im of JSON.parse(p.images)) deleteUploadIfUnused(im); } catch { /* none */ }
      setFlash(res, `Deleted “${p.name}”.`);
    }
    res.redirect('/admin/products');
  });

  // ---------- categories ----------
  r.get('/admin/categories', requireAdmin, (req, res) => {
    res.html(V.categories(ctx(req, res, { cats: all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS count,
      (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS live FROM categories c ORDER BY sort, name`) })));
  });
  r.post('/admin/categories/new', requireAdmin, (req, res) => {
    const name = clip(req.body.name, 60);
    if (name.length < 2) { setFlash(res, 'Category name is required.', 'error'); return res.redirect('/admin/categories'); }
    let slug = slugify(name); let n = 2; while (one('SELECT 1 AS x FROM categories WHERE slug = ?', slug)) slug = `${slugify(name)}-${n++}`;
    const up = saveUploads(req.files, 'image');
    run('INSERT INTO categories (name, slug, description, sort, image) VALUES (?, ?, ?, ?, ?)', name, slug, clip(req.body.description, 300), Number(req.body.sort) || 0, up.saved[0] || '');
    setFlash(res, up.errors.length ? `Category added, but the image was skipped: ${up.errors.join('; ')}` : `Category “${name}” added.`, up.errors.length ? 'warn' : 'ok');
    res.redirect('/admin/categories');
  });
  r.post('/admin/categories/:id', requireAdmin, (req, res) => {
    const c = one('SELECT * FROM categories WHERE id = ?', Number(req.params.id));
    if (!c) return res.redirect('/admin/categories');
    if (req.body.op === 'delete') {
      run('DELETE FROM categories WHERE id = ?', c.id);
      if (c.image) deleteUploadIfUnused(c.image);
      setFlash(res, `Category “${c.name}” deleted.`);
    } else {
      const name = clip(req.body.name, 60);
      if (name.length < 2) { setFlash(res, 'Category name is required.', 'error'); return res.redirect('/admin/categories'); }
      const up = saveUploads(req.files, 'image');
      let image = c.image;
      if (up.saved[0] || req.body.remove_image === '1') image = up.saved[0] || '';
      run('UPDATE categories SET name = ?, description = ?, sort = ?, image = ? WHERE id = ?', name, clip(req.body.description, 300), Number(req.body.sort) || 0, image, c.id);
      if (c.image && c.image !== image) deleteUploadIfUnused(c.image);
      setFlash(res, up.errors.length ? `Saved, but the image was skipped: ${up.errors.join('; ')}` : 'Category saved.', up.errors.length ? 'warn' : 'ok');
    }
    res.redirect('/admin/categories');
  });

  // ---------- messages & reviews ----------
  r.get('/admin/messages', requireAdmin, (req, res) => res.html(V.messages(ctx(req, res, { msgs: all('SELECT * FROM messages ORDER BY is_read, created_at DESC LIMIT 300') }))));
  r.post('/admin/messages/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (req.body.op === 'delete') run('DELETE FROM messages WHERE id = ?', id); else run('UPDATE messages SET is_read = 1 WHERE id = ?', id);
    res.redirect('/admin/messages');
  });
  r.get('/admin/reviews', requireAdmin, (req, res) => res.html(V.reviews(ctx(req, res, {
    products: all('SELECT id, name, active FROM products ORDER BY active DESC, name'),
    list: all(`SELECT rv.*, p.name AS product_name, o.order_number FROM reviews rv LEFT JOIN products p ON p.id = rv.product_id LEFT JOIN orders o ON o.id = rv.order_id ORDER BY rv.approved, rv.created_at DESC`),
  }))));
  r.post('/admin/reviews/new', requireAdmin, (req, res) => {
    const f = req.body;
    const { REVIEW_SOURCES } = require('../views/layout');
    if (f.attest !== 'yes') { setFlash(res, 'Please confirm this is a real review from a real customer.', 'error'); return res.redirect('/admin/reviews'); }
    const source = Object.keys(REVIEW_SOURCES).includes(f.source) && f.source !== 'order' ? f.source : 'other';
    const name = clip(f.name, 60); const body = clip(f.body, 1000);
    if (name.length < 2 || body.length < 3) { setFlash(res, 'Name and review text are required.', 'error'); return res.redirect('/admin/reviews'); }
    const productId = one('SELECT id FROM products WHERE id = ?', Number(f.product_id) || 0)?.id ?? null;
    run('INSERT INTO reviews (product_id, name, rating, body, approved, source) VALUES (?, ?, ?, ?, ?, ?)', productId, name, Math.min(5, Math.max(1, Number(f.rating) || 5)), body, f.publish === '1' ? 1 : 0, source);
    setFlash(res, f.publish === '1' ? 'Review added and published.' : 'Review added as pending.');
    res.redirect('/admin/reviews');
  });
  r.post('/admin/reviews/:id', requireAdmin, (req, res) => {
    const id = Number(req.params.id);
    if (req.body.op === 'delete') run('DELETE FROM reviews WHERE id = ?', id);
    else run('UPDATE reviews SET approved = ? WHERE id = ?', req.body.op === 'approve' ? 1 : 0, id);
    res.redirect('/admin/reviews');
  });

  // ---------- settings & account ----------
  const integrationStatus = () => ({
    stripe: stripe.isConfigured(), stripeMode: stripe.isConfigured() ? (stripe.isTestMode() ? 'Test mode' : 'LIVE mode') : 'Add STRIPE_SECRET_KEY',
    webhook: Boolean(config.stripeWebhookSecret), email: Boolean(config.resendApiKey && config.emailFrom),
    baseUrl: config.baseUrl, baseUrlOk: config.baseUrl.startsWith('https://') || !config.isProd,
  });
  r.get('/admin/settings', requireAdmin, (req, res) => res.html(V.settingsPage(ctx(req, res, { status: integrationStatus() }))));
  r.post('/admin/settings', requireAdmin, (req, res) => {
    const f = req.body;
    for (const k of ['store_name', 'tagline', 'announcement', 'processing_time', 'delivery_time', 'business_address']) if (k in f) setSetting(k, clip(f[k], 300));
    if (f.support_email && isEmail(f.support_email)) setSetting('support_email', clip(f.support_email, 200));
    for (const k of ['shipping_flat_cents', 'free_shipping_threshold_cents', 'fee_fixed_cents']) { const c = toCents(f[k]); if (c !== null) setSetting(k, c); }
    const pct = Number(f.fee_percent); if (Number.isFinite(pct) && pct >= 0 && pct < 20) setSetting('fee_percent', pct);
    setFlash(res, 'Settings saved.'); res.redirect('/admin/settings');
  });
  r.get('/admin/account', requireAdmin, (req, res) => res.html(V.account(ctx(req, res, { admins: all('SELECT name, email, last_login_at FROM admins ORDER BY id') }))));
  r.post('/admin/account', requireAdmin, (req, res) => {
    const f = req.body; const admin = one('SELECT * FROM admins WHERE id = ?', req.session.admin_id);
    if (!auth.verifyPassword(String(f.current || ''), admin.password_hash)) { setFlash(res, 'Current password is incorrect.', 'error'); return res.redirect('/admin/account'); }
    if (String(f.next || '').length < 10 || f.next !== f.confirm) { setFlash(res, 'New passwords must match and be at least 10 characters.', 'error'); return res.redirect('/admin/account'); }
    tx(() => {
      run('UPDATE admins SET password_hash = ? WHERE id = ?', auth.hashPassword(f.next), admin.id);
      run('DELETE FROM sessions WHERE admin_id = ? AND id <> ?', admin.id, req.session.id); // sign out other devices
    });
    setFlash(res, 'Password updated. Other devices were signed out.'); res.redirect('/admin/account');
  });
};
