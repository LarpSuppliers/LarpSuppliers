'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const config = require('./lib/config');
const { Router, serveStatic, enhance } = require('./lib/http');
const { run, one } = require('./lib/db');
const { hashPassword } = require('./lib/auth');
const { isEmail } = require('./lib/util');
const { getSettings } = require('./lib/db');
const views = require('./views/store');
// Create the first owner account if one does not exist.
if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
  const email = process.env.ADMIN_EMAIL.trim();
  const name = process.env.ADMIN_NAME?.trim() || email.split('@')[0];
  const password = process.env.ADMIN_PASSWORD;

  if (!isEmail(email) || password.length < 10) {
    throw new Error('Invalid admin setup environment variables.');
  }

  if (!one('SELECT id FROM admins LIMIT 1')) {
    run(
      'INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)',
      email,
      name,
      hashPassword(password)
    );
    console.log('Initial owner account created.');
  }
}
const router = new Router();
require('./routes/store')(router);
require('./routes/admin')(router);

fs.mkdirSync(config.uploadsDir, { recursive: true });
const staticFiles = serveStatic(path.join(config.root, 'public'), '/static/', { maxAge: config.isProd ? 86400 : 0 });
const uploads = serveStatic(config.uploadsDir, '/uploads/', { maxAge: 604800 });

const CSP = [
  "default-src 'self'", "img-src 'self' data: blob:", "script-src 'self'", "style-src 'self' 'unsafe-inline'",
  "font-src 'self'", "connect-src 'self'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'self'", "object-src 'none'",
].join('; ');

function securityHeaders(req, res) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

const server = http.createServer(async (req, res) => {
  enhance(req, res);
  if (config.trustProxy && req.headers['x-forwarded-for']) req.ip = String(req.headers['x-forwarded-for']).split(',')[0].trim();
  securityHeaders(req, res);
  try {
    if ((req.method === 'GET' || req.method === 'HEAD') && (staticFiles(req, res, req.pathname) || uploads(req, res, req.pathname))) return;
    const match = router.match(req.method, req.pathname);
    if (!match) {
      if (req.pathname.startsWith('/api/')) return res.json({ error: 'Not found' }, 404);
      return res.html(views.notFound({ settings: getSettings() }), 404);
    }
    req.params = match.params;
    for (const h of match.handlers) {
      await h(req, res);
      if (res.writableEnded || res.headersSent) break;
    }
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[error] ${req.method} ${req.pathname}`, err);
    if (res.headersSent) return res.end();
    if (req.pathname.startsWith('/api/') || req.pathname.startsWith('/webhooks/')) return res.json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message }, status);
    res.html(`<!doctype html><meta charset="utf-8"><title>Error</title><body style="font-family:system-ui;background:#0b0b0d;color:#eee;display:grid;place-items:center;height:100vh"><div><h1>Something went wrong</h1><p>${status >= 500 ? 'Please try again in a moment.' : String(err.message).replace(/[<>&]/g, '')}</p><a style="color:#e8cf9f" href="/">Back to store</a></div></body>`, status);
  }
});

// Housekeeping: cancel unpaid orders whose Stripe session has certainly expired (sessions last 1 hour).
setInterval(() => {
  const stale = run(`UPDATE orders SET status = 'Cancelled', updated_at = datetime('now')
    WHERE status = 'Awaiting Payment' AND payment_status = 'unpaid' AND created_at < datetime('now', '-3 hours')`);
  if (stale.changes) console.log(`[cleanup] cancelled ${stale.changes} abandoned unpaid order(s)`);
}, 10 * 60 * 1000).unref();

if (require.main === module) {
  server.listen(config.port, () => {
    const stripe = require('./lib/stripe');
    console.log(`\n  Store running at ${config.baseUrl}  (admin: ${config.baseUrl}/admin)`);
    console.log(`  Stripe: ${stripe.isConfigured() ? (stripe.isTestMode() ? 'TEST mode' : 'LIVE mode') : 'NOT CONFIGURED'} · Webhook secret: ${config.stripeWebhookSecret ? 'set' : 'NOT SET'} · Email: ${config.resendApiKey ? 'Resend' : 'outbox folder (dev)'}\n`);
  });
}

module.exports = server;
