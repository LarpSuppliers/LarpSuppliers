'use strict';
const path = require('node:path');
const fs = require('node:fs');

const root = path.resolve(__dirname, '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = process.env;
const isProd = env.NODE_ENV === 'production';

module.exports = {
  root,
  isProd,
  port: Number(env.PORT) || 3000,
  baseUrl: (env.BASE_URL || `http://localhost:${Number(env.PORT) || 3000}`).replace(/\/$/, ''),
  dataDir: path.resolve(root, env.DATA_DIR || 'data'),
  dbPath: path.resolve(root, env.DATA_DIR || 'data', 'store.db'),
  uploadsDir: path.resolve(root, env.DATA_DIR || 'data', 'uploads'),
  stripeSecretKey: env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
  resendApiKey: env.RESEND_API_KEY || '',
  emailFrom: env.EMAIL_FROM || '',
  adminNotifyEmail: env.ADMIN_NOTIFY_EMAIL || '',
  trustProxy: env.TRUST_PROXY === '1',
};
