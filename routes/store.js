'use strict';
const { one, all, run, getSettings } = require('../lib/db');
const { readBody, parseForm, rateLimiter } = require('../lib/http');
const { clip, isEmail } = require('../lib/util');
const views = require('../views/store');
const policies = require('../views/policies');
const orders = require('../lib/orders');
const stripe = require('../lib/stripe');

// Only public columns ever leave this module — supplier data stays private.
const PUBLIC_COLS = `p.id, p.name, p.slug, p.description, p.details, p.options, p.price_cents, p.compare_at_cents, p.images, p.featured, p.best_seller, p.created_at,
  c.name AS category_name, c.slug AS category_slug, p.category_id`;
const BASE = `SELECT ${PUBLIC_COLS} FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.active = 1`;

const checkoutLimit = rateLimiter({ windowMs: 60_000, max: 12 });
const lookupLimit = rateLimiter({ windowMs: 15 * 60_000, max: 30 });
const contactLimit = rateLimiter({ windowMs: 60 * 60_000, max: 8 });

async function jsonBody(req) {
  const buf = await readBody(req, 100_000);
  try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}
async function formBody(req) { return parseForm(await readBody(req, 100_000)); }

// Basic same-origin check for state-changing JSON endpoints.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

function categoriesWithCounts() {
  return all(`SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS count,
    COALESCE(NULLIF(c.image, ''), (SELECT json_extract(p.images, '$[0]') FROM products p WHERE p.category_id = c.id AND p.active = 1 AND p.images <> '[]' ORDER BY p.featured DESC, p.id LIMIT 1)) AS image
    FROM categories c ORDER BY c.sort, c.name`);
}

module.exports = (r) => {
  r.get('/', (req, res) => {
    const featured = all(`${BASE} AND p.featured = 1 ORDER BY p.updated_at DESC LIMIT 8`);
    const reviews = all(`SELECT rv.*, p.name AS product_name, p.slug AS product_slug FROM reviews rv LEFT JOIN products p ON p.id = rv.product_id
      WHERE rv.approved = 1 ORDER BY rv.created_at DESC LIMIT 6`);
    res.html(views.home({
      settings: getSettings(),
      heroProduct: featured.find((p) => p.images !== '[]') || one(`${BASE} AND p.images <> '[]' ORDER BY p.best_seller DESC, p.id LIMIT 1`),
      featured: featured.slice(0, 4),
      bestSellers: all(`${BASE} AND p.best_seller = 1 ORDER BY p.id LIMIT 4`),
      newArrivals: all(`${BASE} ORDER BY p.created_at DESC, p.id DESC LIMIT 4`),
      deals: all(`${BASE} AND p.compare_at_cents > p.price_cents ORDER BY (1.0 * p.price_cents / p.compare_at_cents) LIMIT 4`),
      categories: categoriesWithCounts().filter((c) => c.count > 0),
      reviews,
    }));
  });

  const shopHandler = (req, res) => {
    const s = getSettings();
    let category = null;
    if (req.params.slug) {
      category = one('SELECT * FROM categories WHERE slug = ?', req.params.slug);
      if (!category) return res.html(views.notFound({ settings: s }), 404);
    }
    const q = clip(req.query.q, 100); const sort = req.query.sort || 'featured';
    const min = /^\d+(\.\d+)?$/.test(req.query.min || '') ? req.query.min : '';
    const max = /^\d+(\.\d+)?$/.test(req.query.max || '') ? req.query.max : '';
    const deals = req.query.deals === '1';
    let sql = BASE; const args = [];
    if (category) { sql += ' AND p.category_id = ?'; args.push(category.id); }
    if (q) { sql += " AND (p.name LIKE ? ESCAPE '\\' OR p.description LIKE ? ESCAPE '\\' OR c.name LIKE ? ESCAPE '\\')"; const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`; args.push(like, like, like); }
    if (min) { sql += ' AND p.price_cents >= ?'; args.push(Math.round(Number(min) * 100)); }
    if (max) { sql += ' AND p.price_cents <= ?'; args.push(Math.round(Number(max) * 100)); }
    if (deals) sql += ' AND p.compare_at_cents > p.price_cents';
    sql += ' ORDER BY ' + ({ newest: 'p.created_at DESC, p.id DESC', 'price-asc': 'p.price_cents ASC', 'price-desc': 'p.price_cents DESC', name: 'p.name COLLATE NOCASE ASC' }[sort] || 'p.featured DESC, p.best_seller DESC, p.id ASC');
    const products = all(sql, ...args);
    res.html(views.shop({ settings: s, products, categories: categoriesWithCounts(), q, category, sort, min, max, deals, total: products.length }));
  };
  r.get('/shop', shopHandler);
  r.get('/category/:slug', shopHandler);

  r.get('/product/:slug', (req, res) => {
    const s = getSettings();
    const p = one(`${BASE} AND p.slug = ?`, req.params.slug);
    if (!p) return res.html(views.notFound({ settings: s }), 404);
    let images = []; try { images = JSON.parse(p.images); } catch { /* none */ }
    const related = all(`${BASE} AND p.id <> ? ORDER BY (p.category_id IS ?) DESC, p.best_seller DESC, RANDOM() LIMIT 4`, p.id, p.category_id);
    const reviews = all('SELECT * FROM reviews WHERE approved = 1 AND product_id = ? ORDER BY created_at DESC LIMIT 20', p.id);
    res.html(views.product({ settings: s, p, images, related, reviews }));
  });

  r.get('/cart', (req, res) => res.html(views.cart({ settings: getSettings() })));
  r.get('/checkout', (req, res) => res.html(views.checkout({ settings: getSettings(), stripeReady: stripe.isConfigured(), testMode: stripe.isTestMode() })));

  // Prices the browser's cart using database prices.
  r.post('/api/cart', async (req, res) => {
    const body = await jsonBody(req);
    const s = getSettings();
    res.json({ ...orders.publicCart(orders.priceCart(body.items)), free_shipping_threshold_cents: Number(s.free_shipping_threshold_cents) || 0 });
  });

  r.post('/api/checkout', async (req, res) => {
    if (!sameOrigin(req)) return res.json({ error: 'Bad origin' }, 403);
    if (!checkoutLimit(req.ip)) return res.json({ error: 'Too many attempts. Please wait a minute and try again.' }, 429);
    if (!stripe.isConfigured()) return res.json({ error: 'Payments are not set up yet. Please try again later.' }, 503);
    const body = await jsonBody(req);
    const { value: customer, errors } = orders.validateCustomer(body.customer);
    if (Object.keys(errors).length) return res.json({ error: 'Please fix the highlighted fields.', fields: errors }, 400);
    const cart = orders.priceCart(body.items);
    if (!cart.lines.length) return res.json({ error: 'Your cart is empty.' }, 400);
    if (cart.removed.length) return res.json({ error: 'Some items in your cart are no longer available and were removed. Please review your cart.', removed: cart.removed }, 409);
    if (cart.total_cents < 50) return res.json({ error: 'Order total is too low.' }, 400);

    const order = orders.createPendingOrder(customer, cart);
    try {
      const session = await stripe.createCheckoutSession({ order, lines: cart.lines, shippingCents: cart.shipping_cents });
      run("UPDATE orders SET stripe_session_id = ?, updated_at = datetime('now') WHERE id = ?", session.id, order.id);
      orders.logEvent(order.id, 'Customer redirected to Stripe Checkout.');
      res.json({ url: session.url });
    } catch (e) {
      console.error('[checkout] Stripe error:', e.message);
      run("UPDATE orders SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ?", order.id);
      orders.logEvent(order.id, `Could not start payment: ${e.message}`);
      res.json({ error: 'We could not start the payment. Please try again in a moment.' }, 502);
    }
  });

  r.get('/checkout/success', async (req, res) => {
    const s = getSettings();
    const sid = String(req.query.session_id || '');
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sid)) return res.redirect('/');
    let order = one('SELECT * FROM orders WHERE stripe_session_id = ?', sid);
    if (!order) return res.html(views.notFound({ settings: s }), 404);
    if (order.payment_status !== 'paid' && stripe.isConfigured()) {
      try {
        const session = await stripe.retrieveSession(sid); // verified directly with Stripe, server-side
        const out = await orders.finalizePaidSession(session, 'confirmation page');
        if (out.order) order = out.order;
      } catch (e) { console.error('[success] verify failed:', e.message); }
    }
    const paid = order.payment_status === 'paid';
    res.setHeader('Cache-Control', 'no-store');
    res.html(views.success({ settings: s, order: paid ? order : null, items: paid ? orders.getItems(order.id) : [], pending: !paid }));
  });

  r.get('/checkout/cancel', (req, res) => res.html(views.cancel({ settings: getSettings() })));

  // ---- Order lookup ----
  r.get('/track', (req, res) => res.html(views.track({ settings: getSettings(), values: { order: clip(req.query.order, 30) } })));
  const findOrder = (num, email) => one('SELECT * FROM orders WHERE order_number = ? AND lower(email) = lower(?) AND payment_status <> \'unpaid\'', clip(num, 30).toUpperCase(), clip(email, 200));
  r.post('/track', async (req, res) => {
    const s = getSettings(); const f = await formBody(req);
    if (!lookupLimit(req.ip)) return res.html(views.track({ settings: s, values: f, error: 'Too many lookups. Please try again later.' }), 429);
    const order = findOrder(f.order || '', f.email || '');
    if (!order) return res.html(views.track({ settings: s, values: f, error: "We couldn't find an order with that number and email. Please check both and try again." }), 404);
    const reviewed = Boolean(one('SELECT 1 AS x FROM reviews WHERE order_id = ?', order.id));
    res.setHeader('Cache-Control', 'no-store');
    res.html(views.track({ settings: s, values: f, order, items: orders.getItems(order.id), reviewed, reviewMsg: reviewed ? 'Thanks — you have already reviewed this order.' : '' }));
  });

  r.post('/review', async (req, res) => {
    const s = getSettings(); const f = await formBody(req);
    if (!lookupLimit(req.ip)) return res.redirect('/track');
    const order = findOrder(f.order || '', f.email || '');
    if (!order || order.status !== 'Delivered') return res.redirect('/track');
    const items = orders.getItems(order.id);
    const rating = Math.min(5, Math.max(1, Number(f.rating) || 5));
    const productId = items.find((i) => String(i.product_id) === String(f.product_id))?.product_id || null;
    const text = clip(f.body, 1000);
    if (text.length >= 3 && !one('SELECT 1 AS x FROM reviews WHERE order_id = ?', order.id)) {
      run('INSERT INTO reviews (order_id, product_id, name, rating, body) VALUES (?, ?, ?, ?, ?)', order.id, productId, clip(f.name, 60) || 'Customer', rating, text);
      orders.logEvent(order.id, `Customer left a ${rating}-star review (pending approval).`, 'customer');
    }
    res.html(views.track({ settings: s, values: { order: order.order_number, email: order.email }, order, items, reviewed: true, reviewMsg: 'Thank you! Your review was submitted and will appear once approved.' }));
  });

  // ---- Contact ----
  r.get('/contact', (req, res) => res.html(views.contact({ settings: getSettings(), sent: req.query.sent === '1' })));
  r.post('/contact', async (req, res) => {
    const s = getSettings(); const f = await formBody(req);
    if (f.website) return res.redirect('/contact?sent=1'); // honeypot
    if (!contactLimit(req.ip)) return res.html(views.contact({ settings: s, values: f, error: 'Too many messages. Please email us directly.' }), 429);
    const name = clip(f.name, 100); const email = clip(f.email, 200); const body = clip(f.body, 4000);
    if (name.length < 2 || !isEmail(email) || body.length < 5) return res.html(views.contact({ settings: s, values: f, error: 'Please enter your name, a valid email and a message.' }), 400);
    run('INSERT INTO messages (name, email, order_number, subject, body) VALUES (?, ?, ?, ?, ?)', name, email, clip(f.order_number, 30), clip(f.subject, 60), body);
    res.redirect('/contact?sent=1');
  });

  // ---- Content pages ----
  for (const key of ['about', 'shipping', 'returns', 'privacy', 'terms']) {
    r.get('/' + key, (req, res) => { const s = getSettings(); const pg = policies[key](s); res.html(views.page({ settings: s, ...pg, active: '/' + key })); });
  }

  r.get('/robots.txt', (req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('User-agent: *\nDisallow: /admin\nDisallow: /api/\nDisallow: /checkout\n'); });
  r.get('/healthz', (req, res) => res.json({ ok: true }));

  // ---- Stripe webhook ----
  r.post('/webhooks/stripe', async (req, res) => {
    const raw = await readBody(req, 1_000_000);
    let event;
    try { event = stripe.verifyWebhook(raw, req.headers['stripe-signature']); } catch (e) {
      console.warn('[webhook] rejected:', e.message);
      return res.json({ error: 'Invalid signature' }, 400);
    }
    const fresh = run('INSERT OR IGNORE INTO webhook_events (id, type) VALUES (?, ?)', event.id, event.type);
    if (!fresh.changes) return res.json({ received: true, duplicate: true });
    try {
      const obj = event.data?.object || {};
      switch (event.type) {
        case 'checkout.session.completed':
        case 'checkout.session.async_payment_succeeded': {
          const out = await orders.finalizePaidSession(obj, 'webhook');
          if (!out.ok && out.reason !== 'not paid yet') console.warn('[webhook] finalize:', out.reason, obj.id);
          break;
        }
        case 'checkout.session.expired':
        case 'checkout.session.async_payment_failed': {
          const id = Number(obj.metadata?.order_id);
          const u = run(`UPDATE orders SET status = 'Cancelled', updated_at = datetime('now') WHERE id = ? AND stripe_session_id = ? AND status = 'Awaiting Payment' AND payment_status = 'unpaid'`, id, obj.id);
          if (u.changes) orders.logEvent(id, event.type.endsWith('expired') ? 'Checkout session expired without payment — order cancelled.' : 'Payment failed — order cancelled.');
          break;
        }
        case 'charge.refunded': {
          const order = one('SELECT * FROM orders WHERE stripe_payment_intent = ?', obj.payment_intent);
          if (order) {
            if (obj.refunded) {
              const u = run(`UPDATE orders SET status = 'Refunded', payment_status = 'refunded', updated_at = datetime('now') WHERE id = ? AND status <> 'Refunded'`, order.id);
              if (u.changes) orders.logEvent(order.id, `Full refund of $${(obj.amount_refunded / 100).toFixed(2)} confirmed by Stripe.`);
            } else {
              orders.logEvent(order.id, `Partial refund confirmed by Stripe: $${(obj.amount_refunded / 100).toFixed(2)} refunded so far.`);
            }
          }
          break;
        }
        default: break;
      }
      res.json({ received: true });
    } catch (e) {
      run('DELETE FROM webhook_events WHERE id = ?', event.id); // let Stripe retry
      throw e;
    }
  });
};
