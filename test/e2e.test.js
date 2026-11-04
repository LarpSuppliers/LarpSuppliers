'use strict';
// End-to-end test: storefront → checkout → (mock) Stripe → signed webhook → admin manual fulfillment.
// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'store-test-'));
const WHSEC = 'whsec_test_secret';

// ---- Mock Stripe API ----
const sessions = new Map();
const stripeCalls = [];
const mock = http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const u = new URL(req.url, 'http://x'); const f = new URLSearchParams(body);
    stripeCalls.push({ method: req.method, path: u.pathname, auth: req.headers.authorization, idem: req.headers['idempotency-key'] });
    const send = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.method === 'POST' && u.pathname === '/v1/checkout/sessions') {
      let total = 0;
      for (let i = 0; f.has(`line_items[${i}][quantity]`); i++) total += Number(f.get(`line_items[${i}][quantity]`)) * Number(f.get(`line_items[${i}][price_data][unit_amount]`));
      total += Number(f.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]') || 0);
      const id = 'cs_test_' + crypto.randomBytes(8).toString('hex');
      const s = { id, object: 'checkout.session', url: `https://checkout.stripe.com/c/pay/${id}`, amount_total: total, currency: 'usd', payment_status: 'unpaid', payment_intent: null, metadata: { order_id: f.get('metadata[order_id]'), order_number: f.get('metadata[order_number]') } };
      sessions.set(id, s); return send(s);
    }
    const m = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(u.pathname);
    if (req.method === 'GET' && m) return sessions.has(m[1]) ? send(sessions.get(m[1])) : send({ error: { message: 'No such session' } }, 404);
    if (req.method === 'GET' && u.pathname.startsWith('/v1/payment_intents/')) return send({ id: 'pi', latest_charge: { balance_transaction: { fee: 247 } } });
    if (req.method === 'POST' && u.pathname === '/v1/refunds') return send({ id: 're_test_1', status: 'succeeded' });
    if (req.method === 'POST' && u.pathname.endsWith('/expire')) return send({ ok: true });
    send({ error: { message: 'unhandled ' + u.pathname } }, 400);
  });
});

let base; let server; let db; let orders;
const jar = {};
async function call(method, p, { json, form, headers = {}, raw } = {}) {
  const h = { ...headers, Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
  let body;
  if (json) { body = JSON.stringify(json); h['Content-Type'] = 'application/json'; }
  if (form) { body = new URLSearchParams(form).toString(); h['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (raw) body = raw;
  const res = await fetch(base + p, { method, headers: h, body, redirect: 'manual' });
  for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar[kv.slice(0, i)] = kv.slice(i + 1); }
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, text, location: res.headers.get('location'), headers: res.headers };
}
const sign = (payload, secret = WHSEC, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
const csrfFrom = (html) => /name="_csrf" value="([a-f0-9]+)"/.exec(html)[1];

test.before(async () => {
  await new Promise((r) => mock.listen(0, r));
  Object.assign(process.env, {
    DATA_DIR: tmp, STRIPE_SECRET_KEY: 'sk_test_dummy', STRIPE_WEBHOOK_SECRET: WHSEC,
    STRIPE_API_BASE: `http://127.0.0.1:${mock.address().port}/v1`, PORT: '0',
  });
  db = require('../lib/db');
  require('../scripts/seed');
  db.run('INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)', 'owner@test.com', 'Owner', require('../lib/auth').hashPassword('correct horse battery'));
  // Seed creates hidden drafts; publish two of them as real products for the test.
  db.run("UPDATE products SET name = 'Test Cologne A', slug = 'test-cologne-a', price_cents = 6900, images = '[\"/uploads/a.png\"]', supplier_url = 'https://supplier.example.com/products/a', supplier_cost_cents = 2400, supplier_shipping_cents = 250, supplier_notes = 'SECRET-NOTE', active = 1 WHERE slug = 'trending-slot-1'");
  db.run("UPDATE products SET name = 'Test Cologne B', slug = 'test-cologne-b', price_cents = 3200, images = '[\"/uploads/b.png\"]', supplier_url = 'https://supplier.example.com/products/b', supplier_cost_cents = 900, supplier_shipping_cents = 300, active = 1 WHERE slug = 'trending-slot-2'");
  orders = require('../lib/orders');
  server = require('../server');
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true }); setTimeout(() => process.exit(0), 50); });

let productA; let productB; let orderId; let sessionId;

test('public pages render and never leak supplier data', async () => {
  productA = db.one("SELECT * FROM products WHERE slug = 'test-cologne-a'");
  productB = db.one("SELECT * FROM products WHERE slug = 'test-cologne-b'");
  for (const p of ['/', '/shop', '/shop?q=test&sort=price-asc', '/category/clothing', `/product/${productA.slug}`, '/cart', '/checkout', '/track', '/contact', '/about', '/shipping', '/returns', '/privacy', '/terms']) {
    const r = await call('GET', p);
    assert.equal(r.status, 200, p);
    assert.ok(!r.text.includes('supplier.example.com'), `supplier URL leaked on ${p}`);
    assert.ok(!r.text.includes('SECRET-NOTE'), `supplier notes leaked on ${p}`);
  }
  const s = await call('GET', '/shop?q=Cologne+A');
  assert.match(s.text, /Test Cologne A/);
  assert.doesNotMatch(s.text, /Test Cologne B/);
  assert.doesNotMatch((await call('GET', '/shop')).text, /Clothing product 1/, 'drafts stay hidden');
  assert.equal((await call('GET', '/product/clothing-slot-1')).status, 404);
  assert.match((await call('GET', '/')).text, /Larp Suppliers/);
  assert.equal((await call('GET', '/admin')).status, 303);
  assert.equal((await call('GET', '/nope')).status, 404);
});

test('cart pricing is computed on the server', async () => {
  const r = await call('POST', '/api/cart', { json: { items: [{ id: productA.id, qty: 2, price: 1 }, { id: 99999, qty: 1 }, { id: productB.id, qty: 500 }] } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.removed, ['99999|[]']);
  const a = r.data.lines.find((l) => l.product_id === productA.id);
  assert.equal(a.unit_price_cents, productA.price_cents);
  assert.equal(r.data.lines.find((l) => l.product_id === productB.id).quantity, 20, 'quantity capped');
  assert.equal(r.data.shipping_cents, 0, 'free shipping above threshold');
  assert.ok(!JSON.stringify(r.data).includes('supplier'));
});

test('checkout validates input and creates a Stripe session with DB prices', async () => {
  const bad = await call('POST', '/api/checkout', { json: { items: [{ id: productA.id, qty: 1 }], customer: { name: 'A', email: 'nope' } } });
  assert.equal(bad.status, 400);
  assert.ok(bad.data.fields.email && bad.data.fields.zip);

  const customer = { name: 'Jamie Rivera', email: 'Jamie@Example.com', address1: '123 Market St', address2: 'Apt 4', city: 'Austin', state: 'TX', zip: '78701', phone: '555-0100' };
  const r = await call('POST', '/api/checkout', { json: { items: [{ id: productA.id, qty: 1 }], customer } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.match(r.data.url, /^https:\/\/checkout\.stripe\.com/);
  const order = db.one('SELECT * FROM orders ORDER BY id DESC LIMIT 1');
  orderId = order.id; sessionId = order.stripe_session_id;
  assert.equal(order.status, 'Awaiting Payment');
  assert.equal(order.total_cents, productA.price_cents + 599);
  assert.equal(sessions.get(sessionId).amount_total, order.total_cents);
  assert.equal(order.email, 'jamie@example.com');
  const call0 = stripeCalls.find((c) => c.path === '/v1/checkout/sessions');
  assert.equal(call0.auth, 'Bearer sk_test_dummy');
  assert.ok(call0.idem.startsWith('checkout-ORD-'));
});

test('unpaid orders cannot be marked paid and success page waits', async () => {
  const r = await call('GET', `/checkout/success?session_id=${sessionId}`);
  assert.equal(r.status, 200);
  assert.match(r.text, /Confirming your payment/);
  assert.equal(orders.getOrder(orderId).payment_status, 'unpaid');
  assert.equal((await call('GET', '/track')).status, 200);
  const t = await call('POST', '/track', { form: { order: orders.getOrder(orderId).order_number, email: 'jamie@example.com' } });
  assert.equal(t.status, 404, 'unpaid orders are not trackable');
});

test('webhook signature is required', async () => {
  const payload = JSON.stringify({ id: 'evt_forged', type: 'checkout.session.completed', data: { object: { ...sessions.get(sessionId), payment_status: 'paid' } } });
  const r1 = await call('POST', '/webhooks/stripe', { raw: payload, headers: { 'stripe-signature': sign(payload, 'whsec_wrong') } });
  assert.equal(r1.status, 400);
  const r2 = await call('POST', '/webhooks/stripe', { raw: payload, headers: { 'stripe-signature': sign(payload, WHSEC, Math.floor(Date.now() / 1000) - 3600) } });
  assert.equal(r2.status, 400, 'stale timestamp rejected');
  assert.equal(orders.getOrder(orderId).payment_status, 'unpaid');
});

test('amount mismatch is never marked paid', async () => {
  const obj = { ...sessions.get(sessionId), payment_status: 'paid', amount_total: 100 };
  const payload = JSON.stringify({ id: 'evt_mismatch', type: 'checkout.session.completed', data: { object: obj } });
  const r = await call('POST', '/webhooks/stripe', { raw: payload, headers: { 'stripe-signature': sign(payload) } });
  assert.equal(r.status, 200);
  const o = orders.getOrder(orderId);
  assert.equal(o.payment_status, 'unpaid');
  assert.match(o.admin_notes, /AMOUNT MISMATCH/);
  db.run("UPDATE orders SET admin_notes = '' WHERE id = ?", orderId);
});

test('valid signed webhook marks order paid exactly once', async () => {
  const s = sessions.get(sessionId); s.payment_status = 'paid'; s.payment_intent = 'pi_test_123';
  const payload = JSON.stringify({ id: 'evt_paid_1', type: 'checkout.session.completed', data: { object: s } });
  const r = await call('POST', '/webhooks/stripe', { raw: payload, headers: { 'stripe-signature': sign(payload) } });
  assert.equal(r.status, 200);
  const dup = await call('POST', '/webhooks/stripe', { raw: payload, headers: { 'stripe-signature': sign(payload) } });
  assert.equal(dup.data.duplicate, true);
  const payload2 = JSON.stringify({ id: 'evt_paid_2', type: 'checkout.session.completed', data: { object: s } });
  await call('POST', '/webhooks/stripe', { raw: payload2, headers: { 'stripe-signature': sign(payload2) } });
  await new Promise((r) => setTimeout(r, 200));
  const o = orders.getOrder(orderId);
  assert.equal(o.status, 'Awaiting Purchase');
  assert.equal(o.payment_status, 'paid');
  assert.equal(o.processing_fee_cents, 247, 'actual Stripe fee fetched');
  assert.equal(o.confirmation_sent, 1);
  const paidEvents = db.all("SELECT * FROM order_events WHERE order_id = ? AND message LIKE 'Payment verified%'", orderId);
  assert.equal(paidEvents.length, 1, 'no duplicate processing');
  const outbox = fs.readdirSync(path.join(tmp, 'outbox'));
  assert.ok(outbox.some((f) => f.includes('Order-confirmed')));
  const succ = await call('GET', `/checkout/success?session_id=${sessionId}`);
  assert.match(succ.text, /Thank you, Jamie/);
});

test('admin login is protected', async () => {
  const bad = await call('POST', '/admin/login', { form: { email: 'owner@test.com', password: 'wrong' } });
  assert.equal(bad.status, 401);
  const ok = await call('POST', '/admin/login', { form: { email: 'owner@test.com', password: 'correct horse battery' } });
  assert.equal(ok.status, 303);
  const dash = await call('GET', '/admin');
  assert.equal(dash.status, 200);
  assert.match(dash.text, /1 order waiting for you to purchase/);
});

test('manual supplier purchase flow', async () => {
  let page = await call('GET', `/admin/orders/${orderId}`);
  assert.match(page.text, /PURCHASE PRODUCT/);
  assert.match(page.text, /href="https:\/\/supplier\.example\.com\/products\/a" target="_blank" rel="noopener noreferrer">PURCHASE PRODUCT/);
  assert.match(page.text, /Jamie Rivera/); assert.match(page.text, /78701/);
  const csrf = csrfFrom(page.text);
  const act = (form) => call('POST', `/admin/orders/${orderId}/action`, { form: { _csrf: csrf, ...form } });

  assert.equal((await call('POST', `/admin/orders/${orderId}/action`, { form: { action: 'mark_purchased', confirm: 'yes' } })).status, 403, 'CSRF required');
  await act({ action: 'mark_purchased' });
  assert.equal(orders.getOrder(orderId).status, 'Awaiting Purchase', 'requires manual confirmation');
  await act({ action: 'mark_shipped' });
  assert.equal(orders.getOrder(orderId).status, 'Awaiting Purchase', 'cannot ship before purchase');
  await act({ action: 'set_status', status: 'Purchased' });
  assert.equal(orders.getOrder(orderId).status, 'Awaiting Purchase', 'cannot bypass confirmation');

  await act({ action: 'mark_purchased', confirm: 'yes', supplier_order_number: 'SUP-777', actual_supplier_cost: '27.10' });
  let o = orders.getOrder(orderId);
  assert.equal(o.status, 'Purchased'); assert.equal(o.supplier_order_number, 'SUP-777'); assert.equal(o.actual_supplier_cost_cents, 2710);

  await act({ action: 'save_tracking', tracking_carrier: 'USPS', tracking_number: '9400 1000 0000 0000 0000 00' });
  o = orders.getOrder(orderId);
  assert.equal(o.tracking_number, '9400100000000000000000');
  assert.match(o.tracking_url, /usps\.com/);
  await act({ action: 'mark_shipped', notify: '1' });
  assert.equal(orders.getOrder(orderId).status, 'Shipped');
  await act({ action: 'mark_delivered' });
  assert.equal(orders.getOrder(orderId).status, 'Delivered');

  // profit: paid 7499 - actual supplier 2710 - fee 247 - other 0 = 4542
  await act({ action: 'save_costs', other_expenses: '1.00', actual_supplier_cost: '27.10' });
  const fin = orders.financials(orders.getOrder(orderId));
  assert.equal(fin.profit, 7499 - 2710 - 247 - 100);
  page = await call('GET', `/admin/orders/${orderId}`);
  assert.match(page.text, /\$44\.42/);
});

test('customer can track and review; review needs approval', async () => {
  const num = orders.getOrder(orderId).order_number;
  const t = await call('POST', '/track', { form: { order: num.toLowerCase(), email: 'JAMIE@example.com' } });
  assert.equal(t.status, 200);
  assert.match(t.text, /9400100000000000000000/);
  assert.ok(!t.text.includes('123 Market St'), 'full street address not shown on lookup');
  await call('POST', '/review', { form: { order: num, email: 'jamie@example.com', name: 'Jamie R.', rating: '5', product_id: String(productA.id), body: 'Great sound and fast delivery.' } });
  assert.doesNotMatch((await call('GET', '/')).text, /Great sound and fast delivery/);
  const rv = db.one('SELECT * FROM reviews');
  const page = await call('GET', '/admin/reviews');
  await call('POST', `/admin/reviews/${rv.id}`, { form: { _csrf: csrfFrom(page.text), op: 'approve' } });
  assert.match((await call('GET', '/')).text, /Great sound and fast delivery/);
});

test('admin product CRUD with image upload', async () => {
  const page = await call('GET', '/admin/products/new');
  const csrf = csrfFrom(page.text);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082', 'hex');
  const fd = new FormData();
  for (const [k, v] of Object.entries({ _csrf: csrf, name: 'Test Widget', description: 'A widget', price: '24.99', supplier_cost: '8.00', supplier_shipping: '2.00', supplier_url: 'https://aliexpress.example/item/1', active: '1', category_id: '1' })) fd.append(k, v);
  fd.append('images', new Blob([png], { type: 'image/png' }), 'w.png');
  fd.append('images', new Blob(['<script>alert(1)</script>'], { type: 'image/png' }), 'evil.png');
  const res = await fetch(base + '/admin/products/new', { method: 'POST', body: fd, redirect: 'manual', headers: { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
  assert.equal(res.status, 303);
  const p = db.one("SELECT * FROM products WHERE name = 'Test Widget'");
  assert.equal(p.price_cents, 2499);
  const imgs = JSON.parse(p.images);
  assert.equal(imgs.length, 1, 'non-image upload rejected');
  assert.equal((await call('GET', imgs[0])).status, 200);
  assert.equal((await call('GET', `/product/${p.slug}`)).status, 200);
  const fd2 = new FormData();
  for (const [k, v] of Object.entries({ _csrf: csrf, name: 'No Photo Scent', price: '50', active: '1' })) fd2.append(k, v);
  await fetch(base + '/admin/products/new', { method: 'POST', body: fd2, redirect: 'manual', headers: { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
  assert.equal(db.one("SELECT active FROM products WHERE name = 'No Photo Scent'").active, 0, 'cannot publish without a photo');
  await call('POST', `/admin/products/${p.id}/delete`, { form: { _csrf: csrf } });
  assert.equal(db.one('SELECT COUNT(*) AS n FROM products WHERE id = ?', p.id).n, 0);
});

test('refund via Stripe and expired sessions', async () => {
  // second order → paid → refund
  const r = await call('POST', '/api/checkout', { json: { items: [{ id: productB.id, qty: 1 }], customer: { name: 'Sam Lee', email: 'sam@example.com', address1: '9 Elm Rd', city: 'Denver', state: 'CO', zip: '80202' } } });
  const o2 = db.one('SELECT * FROM orders WHERE email = ?', 'sam@example.com');
  const s = sessions.get(o2.stripe_session_id); s.payment_status = 'paid'; s.payment_intent = 'pi_test_456';
  await call('GET', `/checkout/success?session_id=${s.id}`); // verifies via Stripe API
  assert.equal(orders.getOrder(o2.id).status, 'Awaiting Purchase');
  const page = await call('GET', `/admin/orders/${o2.id}`);
  await call('POST', `/admin/orders/${o2.id}/action`, { form: { _csrf: csrfFrom(page.text), action: 'refund' } });
  assert.equal(orders.getOrder(o2.id).status, 'Refunded');
  assert.equal(r.status, 200);

  // third order → expires
  await call('POST', '/api/checkout', { json: { items: [{ id: productB.id, qty: 1 }], customer: { name: 'Pat Doe', email: 'pat@example.com', address1: '1 Oak Ave', city: 'Boise', state: 'ID', zip: '83702' } } });
  const o3 = db.one('SELECT * FROM orders WHERE email = ?', 'pat@example.com');
  const payload = JSON.stringify({ id: 'evt_exp', type: 'checkout.session.expired', data: { object: sessions.get(o3.stripe_session_id) } });
  await call('POST', '/webhooks/stripe', { raw: payload, headers: { 'stripe-signature': sign(payload) } });
  assert.equal(orders.getOrder(o3.id).status, 'Cancelled');

  const dash = await call('GET', '/admin');
  assert.match(dash.text, /Total revenue/);
  assert.match(dash.text, /\$74\.99/, 'refunded order excluded from revenue');
});

test('owners can add genuine off-site reviews with a source label', async () => {
  const page = await call('GET', '/admin/reviews');
  const csrf = csrfFrom(page.text);
  await call('POST', '/admin/reviews/new', { form: { _csrf: csrf, name: 'Marcus T.', rating: '5', source: 'instagram', product_id: String(productA.id), body: 'Lasts all day.', publish: '1' } });
  assert.equal(db.one("SELECT COUNT(*) AS n FROM reviews WHERE name = 'Marcus T.'").n, 0, 'attestation required');
  await call('POST', '/admin/reviews/new', { form: { _csrf: csrf, name: 'Marcus T.', rating: '5', source: 'instagram', product_id: String(productA.id), body: 'Lasts all day.', publish: '1', attest: 'yes' } });
  const pp = await call('GET', `/product/${productA.slug}`);
  assert.match(pp.text, /Lasts all day\./);
  assert.match(pp.text, /Via Instagram/);
  assert.match(pp.text, /Verified buyer/);
});

test('product options (size/color) flow through cart, checkout and fulfillment', async () => {
  db.run("UPDATE products SET name = 'Test Hoodie', slug = 'test-hoodie', price_cents = 4500, images = '[\"/uploads/h.png\"]', supplier_url = 'https://supplier.example.com/hoodie', active = 1 WHERE slug = 'clothing-slot-1'");
  const hoodie = db.one("SELECT * FROM products WHERE slug = 'test-hoodie'");
  assert.equal(hoodie.options, 'Size: S, M, L, XL\nColor: Black, White');
  const pp = await call('GET', '/product/test-hoodie');
  assert.match(pp.text, /data-option="Size"/); assert.match(pp.text, /data-opt-value="XL"/);
  assert.match((await call('GET', '/category/clothing')).text, /href="\/product\/test-hoodie" aria-label="Choose options/);

  const r = await call('POST', '/api/cart', { json: { items: [
    { id: hoodie.id, qty: 1 }, // missing options → removed
    { id: hoodie.id, qty: 1, opts: { Size: 'XXXL', Color: 'Black' } }, // invalid value → removed
    { id: hoodie.id, qty: 1, opts: { Size: 'M', Color: 'Black' } },
    { id: hoodie.id, qty: 2, opts: { Color: 'Black', Size: 'M' } }, // same line, different key order → merged
    { id: hoodie.id, qty: 1, opts: { Size: 'L', Color: 'White' } },
  ] } });
  assert.equal(r.data.removed.length, 2);
  assert.equal(r.data.lines.length, 2);
  const m = r.data.lines.find((l) => l.options === 'Size: M · Color: Black');
  assert.equal(m.quantity, 3); assert.equal(m.key, `${hoodie.id}|[["Color","Black"],["Size","M"]]`);

  const co = await call('POST', '/api/checkout', { json: { items: [{ id: hoodie.id, qty: 1, opts: { Size: 'L', Color: 'White' } }], customer: { name: 'Ava Kim', email: 'ava@example.com', address1: '5 Pine St', city: 'Seattle', state: 'WA', zip: '98101' } } });
  assert.equal(co.status, 200);
  const o = db.one("SELECT * FROM orders WHERE email = 'ava@example.com'");
  assert.equal(db.one('SELECT options FROM order_items WHERE order_id = ?', o.id).options, 'Size: L · Color: White');
  const s = sessions.get(o.stripe_session_id); s.payment_status = 'paid'; s.payment_intent = 'pi_hoodie';
  const payload = JSON.stringify({ id: 'evt_hoodie', type: 'checkout.session.completed', data: { object: s } });
  await call('POST', '/webhooks/stripe', { raw: payload, headers: { 'stripe-signature': sign(payload) } });
  assert.equal(orders.getOrder(o.id).status, 'Awaiting Purchase');
  assert.match((await call('GET', `/admin/orders/${o.id}`)).text, /Customer chose: <b>Size: L · Color: White<\/b>/);

  // admin can edit options; malformed input is rejected
  const form = await call('GET', `/admin/products/${hoodie.id}`);
  const fd = new FormData();
  for (const [k, v] of Object.entries({ _csrf: csrfFrom(form.text), name: 'Test Hoodie', price: '45', options: 'Size: S, M\nColor: Red', active: '1' })) fd.append(k, v);
  await fetch(base + `/admin/products/${hoodie.id}`, { method: 'POST', body: fd, redirect: 'manual', headers: { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
  assert.equal(db.one('SELECT options FROM products WHERE id = ?', hoodie.id).options, 'Size: S, M\nColor: Red');
});

test('unlimited categories with images, shown in the menu only when they have live products', async () => {
  const page = await call('GET', '/admin/categories');
  const csrf = csrfFrom(page.text);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000050001a5f645400000000049454e44ae426082', 'hex');
  for (const name of ['Phone Accessories', 'Gaming', 'Pet Supplies']) {
    const fd = new FormData(); fd.append('_csrf', csrf); fd.append('name', name); fd.append('sort', '9');
    fd.append('image', new Blob([png], { type: 'image/png' }), 'c.png');
    const res = await fetch(base + '/admin/categories/new', { method: 'POST', body: fd, redirect: 'manual', headers: { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
    assert.equal(res.status, 303);
  }
  const gaming = db.one("SELECT * FROM categories WHERE slug = 'gaming'");
  assert.match(gaming.image, /^\/uploads\/[a-f0-9]+\.png$/);
  assert.doesNotMatch((await call('GET', '/')).text, /href="\/category\/gaming"/, 'empty category hidden');
  db.run('UPDATE products SET category_id = ? WHERE id = ?', gaming.id, productB.id);
  const home = await call('GET', '/');
  assert.match(home.text, /href="\/category\/gaming" role="menuitem">Gaming/);
  assert.match(home.text, new RegExp(`class="cat-tile[^"]*"[^>]*>\\s*<img src="${gaming.image}"`));
  assert.equal((await call('GET', '/category/gaming')).status, 200);
  await call('POST', '/admin/categories/' + gaming.id, { form: { _csrf: csrf, op: 'delete' } });
  assert.equal(db.one('SELECT category_id FROM products WHERE id = ?', productB.id).category_id, null, 'products survive category deletion');
});

test('contact form stores messages', async () => {
  const r = await call('POST', '/contact', { form: { name: 'Lee', email: 'lee@example.com', subject: 'Other', body: 'Hello there, question about shipping.' } });
  assert.equal(r.status, 303);
  assert.match((await call('GET', '/admin/messages')).text, /question about shipping/);
});
