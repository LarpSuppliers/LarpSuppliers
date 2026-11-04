'use strict';
// Product options (e.g. sizes and colors). Admins enter one option per line:
//   Size: S, M, L, XL
//   Color: Black, White
const MAX_OPTIONS = 3;
const MAX_VALUES = 40;

function parseOptions(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const i = line.indexOf(':');
    if (i < 1) continue;
    const name = line.slice(0, i).trim().slice(0, 30);
    const values = [...new Set(line.slice(i + 1).split(',').map((v) => v.trim().slice(0, 40)).filter(Boolean))].slice(0, MAX_VALUES);
    if (name && values.length && !out.some((o) => o.name.toLowerCase() === name.toLowerCase())) out.push({ name, values });
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

// Normalized text stored on the product (also used to show it back in the admin form).
const formatOptionsText = (defs) => defs.map((d) => `${d.name}: ${d.values.join(', ')}`).join('\n');

// Validates a customer's selection against the product's options. Every option must be chosen.
function validateSelection(defs, raw) {
  const sel = {};
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const k of Object.keys(input)) if (!defs.some((d) => d.name === k)) return null; // unknown option
  for (const d of defs) {
    const v = input[d.name];
    if (typeof v !== 'string' || !d.values.includes(v)) return null;
    sel[d.name] = v;
  }
  return sel;
}

// Same key format the browser uses: id|[["Color","Black"],["Size","M"]]
const lineKey = (id, sel) => `${id}|${JSON.stringify(Object.entries(sel || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1)))}`;
const describe = (sel) => Object.entries(sel || {}).map(([k, v]) => `${k}: ${v}`).join(' · ');

module.exports = { parseOptions, formatOptionsText, validateSelection, lineKey, describe };
