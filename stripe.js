'use strict';
// Thin Stripe REST client (no SDK needed). All calls are server-side only; keys never reach the browser.
const crypto = require('node:crypto');
const config = require('./config');

// STRIPE_API_BASE exists only so the automated tests can point at a local mock. Never set it in production.
const API = process.env.STRIPE_API_BASE || 'https://api.stripe.com/v1';

function isConfigured() { return /^sk_(test|live)_/.test(config.stripeSecretKey) || /^rk_(test|live)_/.test(config.stripeSecretKey); }
function isTestMode() { return config.stripeSecretKey.includes('_test_'); }

// Encode nested objects/arrays the way Stripe expects: a[b][0][c]=v
function encode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? encode(item, `${key}[${i}]`, out) : out.push([`${key}[${i}]`, String(item)])));
    else if (typeof v === 'object') encode(v, key, out);
    else out.push([key, String(v)]);
  }
  return out;
}

async function request(method, path, params, { idempotencyKey } = {}) {
  if (!isConfigured()) throw new Error('Stripe is not configured. Set STRIPE_SECRET_KEY in your .env file.');
  const headers = { Authorization: `Bearer ${config.stripeSecretKey}`, 'Stripe-Version': '2024-06-20' };
  let url = API + path; let body;
  if (params) {
    const qs = new URLSearchParams(encode(params)).toString();
    if (method === 'GET') url += '?' + qs; else { body = qs; headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Stripe request failed (${res.status})`);
    err.stripe = data?.error; err.status = res.status;
    throw err;
  }
  return data;
}

function createCheckoutSession({ order, lines, shippingCents }) {
  const isHttps = config.baseUrl.startsWith('https://');
  return request('POST', '/checkout/sessions', {
    mode: 'payment',
    customer_email: order.email,
    client_reference_id: order.order_number,
    metadata: { order_id: order.id, order_number: order.order_number },
    payment_intent_data: { metadata: { order_id: order.id, order_number: order.order_number } },
    line_items: lines.map((l) => ({
      quantity: l.quantity,
      price_data: {
        currency: 'usd',
        unit_amount: l.unit_price_cents,
        product_data: {
          name: l.options ? `${l.name} (${l.options})`.slice(0, 250) : l.name,
          // Stripe can only show images reachable over public HTTPS.
          images: isHttps && l.image && !l.image.endsWith('.svg') ? [config.baseUrl + l.image] : undefined,
        },
      },
    })),
    shipping_options: [{
      shipping_rate_data: {
        type: 'fixed_amount', display_name: shippingCents === 0 ? 'Free shipping' : 'Standard shipping',
        fixed_amount: { amount: shippingCents, currency: 'usd' },
      },
    }],
    expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 1 hour to complete payment
    success_url: `${config.baseUrl}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.baseUrl}/checkout/cancel?order=${encodeURIComponent(order.order_number)}`,
  }, { idempotencyKey: `checkout-${order.order_number}` });
}

const retrieveSession = (id) => request('GET', `/checkout/sessions/${encodeURIComponent(id)}`);
const expireSession = (id) => request('POST', `/checkout/sessions/${encodeURIComponent(id)}/expire`);

async function getActualFee(paymentIntentId) {
  const pi = await request('GET', `/payment_intents/${encodeURIComponent(paymentIntentId)}`, { expand: ['latest_charge.balance_transaction'] });
  const bt = pi?.latest_charge?.balance_transaction;
  return bt && typeof bt === 'object' ? bt.fee : null;
}

const createRefund = (paymentIntentId, orderNumber) =>
  request('POST', '/refunds', { payment_intent: paymentIntentId, metadata: { order_number: orderNumber } }, { idempotencyKey: `refund-${orderNumber}` });

// Verify the Stripe-Signature header (HMAC-SHA256 over "timestamp.payload").
function verifyWebhook(rawBody, sigHeader, secret = config.stripeWebhookSecret, toleranceSec = 300) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
  const parts = String(sigHeader || '').split(',').map((p) => p.split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (!t || !sigs.length) throw new Error('Invalid signature header');
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) throw new Error('Signature timestamp outside tolerance');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody.toString('utf8')}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) throw new Error('Signature verification failed');
  return JSON.parse(rawBody.toString('utf8'));
}

module.exports = { isConfigured, isTestMode, createCheckoutSession, retrieveSession, expireSession, getActualFee, createRefund, verifyWebhook, encode };
