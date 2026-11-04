'use strict';
// Creates (or resets the password of) an owner account for the admin dashboard.
// Usage: npm run create-admin
//   Non-interactive: ADMIN_EMAIL=a@b.com ADMIN_NAME="Alex" ADMIN_PASSWORD="..." npm run create-admin
const readline = require('node:readline');
const { one, run, all } = require('../lib/db');
const { hashPassword } = require('../lib/auth');
const { isEmail } = require('../lib/util');

function ask(rl, q, hidden = false) {
  return new Promise((resolve) => {
    if (!hidden) return rl.question(q, (a) => resolve(a.trim()));
    const out = rl.output; const write = out.write.bind(out);
    out.write = (s) => (s.includes(q) ? write(s) : write(''));
    rl.question(q, (a) => { out.write = write; write('\n'); resolve(a); });
  });
}

(async () => {
  let { ADMIN_EMAIL: email, ADMIN_NAME: name, ADMIN_PASSWORD: password } = process.env;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (!email) email = await ask(rl, 'Owner email: ');
  if (!isEmail(email)) { console.error('✗ Invalid email.'); process.exit(1); }
  const existing = one('SELECT * FROM admins WHERE email = ?', email);
  if (!name && !existing) name = await ask(rl, 'Name: ');
  if (!password) {
    password = await ask(rl, 'Password (min 10 characters): ', true);
    const again = await ask(rl, 'Repeat password: ', true);
    if (password !== again) { console.error('✗ Passwords do not match.'); process.exit(1); }
  }
  rl.close();
  if (String(password).length < 10) { console.error('✗ Password must be at least 10 characters.'); process.exit(1); }

  if (existing) {
    run('UPDATE admins SET password_hash = ?, name = COALESCE(?, name) WHERE id = ?', hashPassword(password), name || null, existing.id);
    run('DELETE FROM sessions WHERE admin_id = ?', existing.id);
    console.log(`✓ Password reset for ${email}. Existing sessions were signed out.`);
  } else {
    run('INSERT INTO admins (email, name, password_hash) VALUES (?, ?, ?)', email, name || email.split('@')[0], hashPassword(password));
    console.log(`✓ Owner account created for ${email}.`);
  }
  const count = all('SELECT id FROM admins').length;
  if (count > 2) console.log(`⚠ There are now ${count} owner accounts. Remove extras with: npm run remove-admin -- someone@example.com`);
})();
