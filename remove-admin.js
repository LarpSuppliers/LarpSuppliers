'use strict';
// Usage: npm run remove-admin -- someone@example.com
const { one, run } = require('../lib/db');
const email = process.argv[2];
if (!email) { console.error('Usage: npm run remove-admin -- someone@example.com'); process.exit(1); }
const a = one('SELECT id FROM admins WHERE email = ?', email);
if (!a) { console.error('No owner account with that email.'); process.exit(1); }
run('DELETE FROM admins WHERE id = ?', a.id);
console.log(`✓ Removed ${email}.`);
