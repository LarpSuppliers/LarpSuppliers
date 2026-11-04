'use strict';
const crypto = require('node:crypto');

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const money = (cents) => '$' + (Number(cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// "$12.34" / "12.34" / "12" -> 1234 cents. Returns null if invalid.
function toCents(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0 || n > 1e7) return null;
  return Math.round(n * 100);
}
const centsToInput = (c) => (c === null || c === undefined ? '' : (c / 100).toFixed(2));

const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 80) || 'item';

function orderNumber() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return `ORD-${s.slice(0, 4)}-${s.slice(4)}`;
}

const isEmail = (e) => /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/.test(String(e || ''));

function safeUrl(u) {
  try { const x = new URL(String(u).trim()); return ['http:', 'https:'].includes(x.protocol) ? x.toString() : ''; } catch { return ''; }
}

const fmtDate = (d) => (d ? new Date(d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z')).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const fmtDay = (d) => (d ? new Date(d.replace(' ', 'T') + (d.includes('Z') ? '' : 'Z')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—');

const clip = (s, n) => String(s ?? '').trim().slice(0, n);

module.exports = { esc, money, toCents, centsToInput, slugify, orderNumber, isEmail, safeUrl, fmtDate, fmtDay, clip };
