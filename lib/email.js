'use strict';
// Sends transactional email through Resend (https://resend.com). If no key is configured,
// emails are written to data/outbox/ so you can preview them during development.
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const { getSettings } = require('./db');
const { esc, money } = require('./util');

async function sendEmail({ to, subject, html, replyTo }) {
  if (!to) return;
  if (!config.resendApiKey || !config.emailFrom) {
    const dir = path.join(config.dataDir, 'outbox');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${String(subject).replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.html`);
    fs.writeFileSync(file, `<!-- To: ${esc(to)} | Subject: ${esc(subject)} -->\n${html}`);
    console.log(`[email] (not sent — RESEND_API_KEY/EMAIL_FROM not set) "${subject}" → ${to}  saved to ${path.relative(config.root, file)}`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.emailFrom, to: [to], subject, html, reply_to: replyTo || undefined }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Email failed (${res.status}): ${await res.text().catch(() => '')}`);
}

function shell(s, title, inner) {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">
<div style="max-width:560px;margin:0 auto;padding:32px 16px">
  <div style="font-size:20px;font-weight:700;letter-spacing:.04em;margin-bottom:24px">${esc(s.store_name)}</div>
  <div style="background:#fff;border-radius:12px;padding:28px">
    <h1 style="font-size:20px;margin:0 0 16px">${esc(title)}</h1>${inner}
  </div>
  <p style="font-size:12px;color:#71717a;margin-top:20px">Questions? Reply to this email or contact ${esc(s.support_email)}.</p>
</div></body></html>`;
}

function itemsTable(order, items) {
  const rows = items.map((i) => `<tr><td style="padding:8px 0">${esc(i.name)} × ${i.quantity}${i.options ? `<br><span style="color:#71717a;font-size:12px">${esc(i.options)}</span>` : ''}</td><td style="padding:8px 0;text-align:right">${money(i.unit_price_cents * i.quantity)}</td></tr>`).join('');
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
  <tr><td style="padding:8px 0;border-top:1px solid #e4e4e7">Subtotal</td><td style="text-align:right;border-top:1px solid #e4e4e7">${money(order.subtotal_cents)}</td></tr>
  <tr><td style="padding:4px 0">Shipping</td><td style="text-align:right">${order.shipping_cents ? money(order.shipping_cents) : 'Free'}</td></tr>
  <tr><td style="padding:8px 0;font-weight:700">Total</td><td style="text-align:right;font-weight:700">${money(order.total_cents)}</td></tr></table>`;
}

function orderConfirmation(order, items) {
  const s = getSettings();
  const lookup = `${config.baseUrl}/track?order=${encodeURIComponent(order.order_number)}`;
  const html = shell(s, 'Thanks for your order!', `
    <p style="font-size:14px;line-height:1.6">Hi ${esc(order.customer_name.split(' ')[0])}, we've received your payment for order <b>${esc(order.order_number)}</b>.</p>
    <p style="font-size:14px;line-height:1.6">Orders are processed within ${esc(s.processing_time)} and typically arrive within ${esc(s.delivery_time)} after that. We'll email you a tracking number as soon as your order ships.</p>
    ${itemsTable(order, items)}
    <p style="font-size:14px;line-height:1.6;margin-top:20px"><b>Shipping to:</b><br>${esc(order.customer_name)}<br>${esc(order.address1)}${order.address2 ? '<br>' + esc(order.address2) : ''}<br>${esc(order.city)}, ${esc(order.state)} ${esc(order.zip)}</p>
    <p style="margin-top:24px"><a href="${esc(lookup)}" style="background:#18181b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px">Track your order</a></p>`);
  return sendEmail({ to: order.email, subject: `Order confirmed — ${order.order_number}`, html, replyTo: s.support_email });
}

function shippingUpdate(order) {
  const s = getSettings();
  const html = shell(s, 'Your order is on the way', `
    <p style="font-size:14px;line-height:1.6">Good news — order <b>${esc(order.order_number)}</b> has shipped.</p>
    ${order.tracking_number ? `<p style="font-size:14px">Carrier: <b>${esc(order.tracking_carrier || '—')}</b><br>Tracking number: <b>${esc(order.tracking_number)}</b></p>` : ''}
    ${order.tracking_url ? `<p><a href="${esc(order.tracking_url)}" style="background:#18181b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px">Track package</a></p>` : ''}
    <p style="font-size:13px;color:#71717a">Tracking can take 24–48 hours to show the first update.</p>`);
  return sendEmail({ to: order.email, subject: `Your order ${order.order_number} has shipped`, html, replyTo: s.support_email });
}

function adminNewOrder(order, items) {
  if (!config.adminNotifyEmail) return;
  const s = getSettings();
  const html = shell(s, `New paid order ${order.order_number}`, `
    <p style="font-size:14px">${esc(order.customer_name)} paid ${money(order.total_cents)}. This order is waiting for you to purchase it from the supplier.</p>
    ${itemsTable(order, items)}
    <p style="margin-top:20px"><a href="${esc(config.baseUrl)}/admin/orders/${order.id}" style="background:#18181b;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px">Open in dashboard</a></p>`);
  return Promise.all(config.adminNotifyEmail.split(',').map((to) => sendEmail({ to: to.trim(), subject: `🛒 New order ${order.order_number} — ${money(order.total_cents)}`, html })));
}

module.exports = { sendEmail, orderConfirmation, shippingUpdate, adminNewOrder };
