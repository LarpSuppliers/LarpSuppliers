'use strict';
// Minimal, dependency-free HTTP helpers: routing, body parsing, cookies, static files.
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, ...handlers) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-zA-Z_]+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, handlers });
  }
  get(p, ...h) { this.add('GET', p, ...h); }
  post(p, ...h) { this.add('POST', p, ...h); }
  match(method, pathname) {
    for (const r of this.routes) {
      if (r.method !== method && !(method === 'HEAD' && r.method === 'GET')) continue;
      const m = r.re.exec(pathname);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
        return { handlers: r.handlers, params };
      }
    }
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) { try { out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } catch { /* ignore */ } }
  });
  return out;
}

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Request body too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseForm(buf) {
  const out = {};
  for (const [k, v] of new URLSearchParams(buf.toString('utf8'))) {
    if (k.endsWith('[]')) (out[k.slice(0, -2)] ||= []).push(v); else out[k] = v;
  }
  return out;
}

// Minimal multipart/form-data parser (fields + files kept in memory; size capped by readBody limit).
function parseMultipart(buf, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  if (!m) throw Object.assign(new Error('Bad multipart'), { status: 400 });
  const boundary = Buffer.from('--' + (m[1] || m[2]));
  const fields = {}; const files = [];
  let pos = buf.indexOf(boundary);
  while (pos !== -1) {
    const start = pos + boundary.length;
    if (buf.slice(start, start + 2).toString() === '--') break;
    const headerEnd = buf.indexOf('\r\n\r\n', start);
    if (headerEnd === -1) break;
    const headers = buf.slice(start + 2, headerEnd).toString('utf8');
    const next = buf.indexOf(boundary, headerEnd);
    if (next === -1) break;
    const content = buf.slice(headerEnd + 4, next - 2); // strip trailing \r\n
    const name = /name="([^"]*)"/i.exec(headers)?.[1];
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    if (name) {
      if (filename !== undefined) {
        if (filename && content.length) files.push({ field: name, filename, data: content, type: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1] || '' });
      } else {
        const v = content.toString('utf8');
        if (name.endsWith('[]')) (fields[name.slice(0, -2)] ||= []).push(v); else fields[name] = v;
      }
    }
    pos = next;
  }
  return { fields, files };
}

function serveStatic(rootDir, prefix, { maxAge = 3600 } = {}) {
  const root = path.resolve(rootDir);
  return (req, res, pathname) => {
    if (!pathname.startsWith(prefix)) return false;
    let rel;
    try { rel = decodeURIComponent(pathname.slice(prefix.length)); } catch { return false; }
    const file = path.resolve(root, '.' + path.sep + rel);
    if (!file.startsWith(root + path.sep)) return false;
    let stat;
    try { stat = fs.statSync(file); } catch { return false; }
    if (!stat.isFile()) return false;
    const etag = `W/"${stat.size}-${stat.mtimeMs}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304); res.end(); return true; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size, 'Cache-Control': `public, max-age=${maxAge}`, ETag: etag,
    });
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(file).pipe(res);
    return true;
  };
}

function enhance(req, res) {
  const url = new URL(req.url, 'http://local');
  req.pathname = url.pathname;
  req.query = Object.fromEntries(url.searchParams);
  req.cookies = parseCookies(req.headers.cookie);
  req.ip = (req.socket.remoteAddress || '').replace('::ffff:', '');
  res.html = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
  res.json = (obj, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  res.redirect = (loc, status = 303) => { res.writeHead(status, { Location: loc }); res.end(); };
  res.cookies = [];
  res.setCookie = (name, value, opts = {}) => {
    let c = `${name}=${encodeURIComponent(value)}; Path=${opts.path || '/'}; SameSite=${opts.sameSite || 'Lax'}`;
    if (opts.httpOnly !== false) c += '; HttpOnly';
    if (opts.secure) c += '; Secure';
    if (opts.maxAge !== undefined) c += `; Max-Age=${opts.maxAge}`;
    res.cookies.push(c);
    res.setHeader('Set-Cookie', res.cookies);
  };
}

// Simple fixed-window rate limiter (in-memory).
function rateLimiter({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (v.reset < now) hits.delete(k); }, windowMs).unref();
  return (key) => {
    const now = Date.now();
    let h = hits.get(key);
    if (!h || h.reset < now) { h = { count: 0, reset: now + windowMs }; hits.set(key, h); }
    h.count++;
    return h.count <= max;
  };
}

module.exports = { Router, parseCookies, readBody, parseForm, parseMultipart, serveStatic, enhance, rateLimiter, MIME };
