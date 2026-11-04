'use strict';
// Core order logic: server-side pricing, order creation, payment finalization, profit math.
const { one, all, run, tx, getSettings } = require('./db');
const { orderNumber, clip, isEmail } = require('./util');
const stripe = require('./stripe');
const email = require('./email');
const opt = require('./options');

const STATUSES = ['Awaiting Payment', 'Paid', 'Awaiting Purchase', 'Purchased', 'Shipped', 'Delivered', 'Cancelled', 'Refunded'];
const MAX_QTY = 20;

const firstImage = (p) => { try { return JSON.parse(p.images)[0] || ''; } catch { return ''; } };

function shippingFor(subtotal, s = getSettings()) {
  const flat = Number(s.shipping_flat_cents) || 0;
  const free = Number(s.free_shipping_threshold_cents) || 0;
  if (subtotal === 0) return 0;
  return free > 0 && subtotal >= free ? 0 : flat;
}

// Prices a cart using ONLY database prices. Client-sent prices are never trusted.
// Each cart line is { id, qty, opts } where opts is the chosen options, e.g. { Size: "M" }.
function priceCart(rawItems) {
  const merged = new Map(); const removed = [];
  for (const it of Array.isArray(rawItems) ? rawItems.slice(0, 50) : []) {
    const id = Number(it?.id); const qty = Math.floor(Number(it?.qty));
    if (!Number.isInteger(id) || id <= 0 || !Number.isFinite(qty) || qty <= 0) continue;
    const p = one('SELECT * FROM products WHERE id = ? AND active = 1', id);
    const rawKey = opt.lineKey(id, it?.opts && typeof it.opts === 'object' ? it.opts : {});
    if (!p) { removed.push(rawKey); continue; }
    const sel = opt.validateSelection(opt.parseOptions(p.options), it?.opts);
    if (!sel) { removed.push(rawKey); continue; }
    const key = opt.lineKey(id, sel);
    const prev = merged.get(key);
    merged.set(key, { p, sel, qty: Math.min(MAX_QTY, (prev?.qty || 0) + qty) });
  }
  const lines = [];
  for (const [key, { p, sel, qty }] of merged) {
    lines.push({
      key, product_id: p.id, slug: p.slug, name: p.name, image: firstImage(p), quantity: qty, selected: sel, options: opt.describe(sel),
      unit_price_cents: p.price_cents, line_total_cents: p.price_cents * qty,
      supplier_url: p.supplier_url, supplier_cost_cents: p.supplier_cost_cents, supplier_shipping_cents: p.supplier_shipping_cents,
    });
  }
  const subtotal = lines.reduce((a, l) => a + l.line_total_cents, 0);
  const shipping = shippingFor(subtotal);
  return { lines, removed, subtotal_cents: subtotal, shipping_cents: shipping, total_cents: subtotal + shipping };
}

// Public view of a priced cart (no supplier info).
const publicCart = (c) => ({
  lines: c.lines.map(({ key, product_id, slug, name, image, quantity, selected, options, unit_price_cents, line_total_cents }) => ({ key, product_id, slug, name, image, quantity, selected, options, unit_price_cents, line_total_cents })),
  removed: c.removed, subtotal_cents: c.subtotal_cents, shipping_cents: c.shipping_cents, total_cents: c.total_cents,
});

const US_STATES = 'AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' ');

function validateCustomer(c = {}) {
  const v = {
    customer_name: clip(c.name, 120), email: clip(c.email, 200).toLowerCase(), phone: clip(c.phone, 40),
    address1: clip(c.address1, 200), address2: clip(c.address2, 200), city: clip(c.city, 100),
    state: clip(c.state, 2).toUpperCase(), zip: clip(c.zip, 10), country: 'US',
  };
  const errors = {};
  if (v.customer_name.length < 2) errors.name = 'Please enter your full name.';
  if (!isEmail(v.email)) errors.email = 'Please enter a valid email address.';
  if (v.address1.length < 4) errors.address1 = 'Please enter your street address.';
  if (v.city.length < 2) errors.city = 'Please enter your city.';
  if (!US_STATES.includes(v.state)) errors.state = 'Please choose your state.';
  if (!/^\d{5}(-\d{4})?$/.test(v.zip)) errors.zip = 'Please enter a valid ZIP code.';
  return { value: v, errors };
}

function createPendingOrder(customer, cart) {
  return tx(() => {
    let num; do { num = orderNumber(); } while (one('SELECT 1 AS x FROM orders WHERE order_number = ?', num));
    const r = run(`INSERT INTO orders (order_number, status, payment_status, customer_name, email, phone, address1, address2, city, state, zip, country,
      subtotal_cents, shipping_cents, total_cents) VALUES (?, 'Awaiting Payment', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      num, customer.customer_name, customer.email, customer.phone, customer.address1, customer.address2, customer.city, customer.state, customer.zip, customer.country,
      cart.subtotal_cents, cart.shipping_cents, cart.total_cents);
    const orderId = Number(r.lastInsertRowid);
    for (const l of cart.lines) {
      run(`INSERT INTO order_items (order_id, product_id, name, options, image, unit_price_cents, quantity, supplier_url, supplier_cost_cents, supplier_shipping_cents)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, orderId, l.product_id, l.name, l.options || '', l.image, l.unit_price_cents, l.quantity, l.supplier_url, l.supplier_cost_cents, l.supplier_shipping_cents);
    }
    logEvent(orderId, 'Order created — waiting for customer to complete payment.');
    return getOrder(orderId);
  });
}

const getOrder = (id) => one('SELECT * FROM orders WHERE id = ?', id);
const getItems = (orderId) => all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', orderId);
const logEvent = (orderId, message, actor = 'system') => run('INSERT INTO order_events (order_id, message, actor) VALUES (?, ?, ?)', orderId, message, actor);

function estimateFee(totalCents, s = getSettings()) {
  return Math.round(totalCents * (Number(s.fee_percent) || 0) / 100 + (Number(s.fee_fixed_cents) || 0));
}

/**
 * Marks an order paid ONLY after verifying a Stripe Checkout Session object that came from
 * Stripe itself (signed webhook or a server-side API fetch). Idempotent: safe to call many times.
 */
async function finalizePaidSession(session, source) {
  if (!session || session.object !== 'checkout.session') return { ok: false, reason: 'not a session' };
  const orderId = Number(session.metadata?.order_id);
  const order = orderId ? getOrder(orderId) : null;
  if (!order) return { ok: false, reason: 'order not found' };
  if (order.stripe_session_id && order.stripe_session_id !== session.id) return { ok: false, reason: 'session mismatch' };
  if (session.payment_status !== 'paid') return { ok: false, reason: 'not paid yet', order };

  if (session.amount_total !== order.total_cents || String(session.currency).toLowerCase() !== 'usd') {
    if (!/AMOUNT MISMATCH/.test(order.admin_notes || '')) {
      run("UPDATE orders SET admin_notes = trim(admin_notes || char(10) || ?), updated_at = datetime('now') WHERE id = ?",
        `⚠ AMOUNT MISMATCH: Stripe charged ${session.amount_total} ${session.currency}, expected ${order.total_cents} usd. Review before fulfilling.`, order.id);
      logEvent(order.id, `Payment amount mismatch detected (${source}). Order NOT marked paid — review in Stripe.`);
    }
    return { ok: false, reason: 'amount mismatch', order };
  }

  const fee = estimateFee(order.total_cents);
  const upd = run(`UPDATE orders SET status = 'Awaiting Purchase', payment_status = 'paid', amount_paid_cents = ?, stripe_payment_intent = ?,
      processing_fee_cents = COALESCE(processing_fee_cents, ?), paid_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ? AND payment_status <> 'paid' AND status IN ('Awaiting Payment', 'Cancelled')`,
    session.amount_total, typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null, fee, order.id);

  const fresh = getOrder(order.id);
  if (upd.changes !== 1) return { ok: true, order: fresh, already: true };

  logEvent(order.id, `Payment verified with Stripe (${source}). Amount: $${(session.amount_total / 100).toFixed(2)}.`);
  logEvent(order.id, 'Order is waiting for manual supplier purchase.');
  const items = getItems(order.id);

  // Side effects run after the DB is updated; failures are logged, never block the order.
  (async () => {
    if (!fresh.confirmation_sent) {
      try { await email.orderConfirmation(fresh, items); run('UPDATE orders SET confirmation_sent = 1 WHERE id = ?', fresh.id); logEvent(fresh.id, 'Confirmation email sent to customer.'); }
      catch (e) { logEvent(fresh.id, `Confirmation email failed: ${e.message}`); }
    }
    try { await email.adminNewOrder(fresh, items); } catch (e) { console.error('[email] admin notify failed', e.message); }
    if (fresh.stripe_payment_intent && stripe.isConfigured()) {
      try {
        const actual = await stripe.getActualFee(fresh.stripe_payment_intent);
        if (Number.isInteger(actual)) run('UPDATE orders SET processing_fee_cents = ?, fee_is_actual = 1 WHERE id = ?', actual, fresh.id);
      } catch { /* keep the estimate */ }
    }
  })();

  return { ok: true, order: fresh, newlyPaid: true };
}

// ---- Profit calculations (admin only) ----
function financials(order, items = getItems(order.id)) {
  const revenue = order.payment_status === 'paid' || order.payment_status === 'refunded' ? (order.amount_paid_cents ?? order.total_cents) : 0;
  const estSupplier = items.reduce((a, i) => a + i.supplier_cost_cents * i.quantity, 0);
  const supplierShipping = items.reduce((a, i) => a + i.supplier_shipping_cents * i.quantity, 0);
  const supplierCost = order.actual_supplier_cost_cents ?? estSupplier;
  const fee = order.processing_fee_cents ?? (revenue ? estimateFee(revenue) : 0);
  const other = order.other_expenses_cents || 0;
  const refunded = order.status === 'Refunded';
  // Refunded orders: revenue returned; Stripe keeps the fee; supplier cost counts only if we already bought it.
  const boughtFromSupplier = Boolean(order.purchased_at);
  const supplierTotal = refunded && !boughtFromSupplier ? 0 : supplierCost + (order.actual_supplier_cost_cents != null ? 0 : supplierShipping);
  const effRevenue = refunded ? 0 : revenue;
  const profit = effRevenue - supplierTotal - (revenue ? fee : 0) - other;
  return {
    revenue: effRevenue, grossPaid: revenue, supplierCost, supplierShipping, supplierTotal, fee, feeIsActual: Boolean(order.fee_is_actual), other, profit,
    estSupplier, usingActualSupplier: order.actual_supplier_cost_cents != null,
    items: items.map((i) => ({ ...i, profitPerUnit: i.unit_price_cents - i.supplier_cost_cents - i.supplier_shipping_cents, lineProfit: (i.unit_price_cents - i.supplier_cost_cents - i.supplier_shipping_cents) * i.quantity })),
  };
}

module.exports = { STATUSES, MAX_QTY, priceCart, publicCart, validateCustomer, createPendingOrder, getOrder, getItems, logEvent, finalizePaidSession, financials, estimateFee, shippingFor, firstImage, US_STATES };
