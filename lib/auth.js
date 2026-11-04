'use strict';
const crypto = require('node:crypto');
const { one, run } = require('./db');
const config = require('./config');

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const COOKIE = config.isProd ? '__Host-admin_sid' : 'admin_sid';

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [alg, saltHex, hashHex] = String(stored).split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

// A dummy hash so login timing doesn't reveal whether an email exists.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

function login(email, password) {
  const admin = one('SELECT * FROM admins WHERE email = ?', String(email || '').trim());
  const ok = verifyPassword(String(password || ''), admin ? admin.password_hash : DUMMY_HASH);
  return ok && admin ? admin : null;
}

function createSession(res, adminId, ip) {
  const id = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
  run('INSERT INTO sessions (id, admin_id, csrf, expires_at, ip) VALUES (?, ?, ?, ?, ?)', id, adminId, csrf, Date.now() + SESSION_TTL_MS, ip);
  run("UPDATE admins SET last_login_at = datetime('now') WHERE id = ?", adminId);
  res.setCookie(COOKIE, id, { httpOnly: true, secure: config.isProd, sameSite: 'Strict', maxAge: SESSION_TTL_MS / 1000 });
}

function loadSession(req) {
  const id = req.cookies[COOKIE];
  if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const s = one(`SELECT s.id, s.csrf, s.expires_at, a.id AS admin_id, a.email, a.name
                 FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.id = ?`, id);
  if (!s || s.expires_at < Date.now()) return null;
  return s;
}

function destroySession(req, res) {
  const id = req.cookies[COOKIE];
  if (id) run('DELETE FROM sessions WHERE id = ?', id);
  res.setCookie(COOKIE, '', { httpOnly: true, secure: config.isProd, sameSite: 'Strict', maxAge: 0 });
}

function checkCsrf(req, body) {
  const token = (body && body._csrf) || req.headers['x-csrf-token'];
  if (!req.session || !token) return false;
  const a = Buffer.from(String(token)); const b = Buffer.from(req.session.csrf);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = { hashPassword, verifyPassword, login, createSession, loadSession, destroySession, checkCsrf };
