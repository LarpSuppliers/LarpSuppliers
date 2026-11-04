'use strict';
// Sets up a starting catalog: general store categories and empty product slots (hidden drafts).
// Fill each one in from the dashboard (name, photos, price, supplier link) and tick "Active" to publish.
// Add, rename or delete categories any time under Dashboard → Categories.
// Usage: npm run seed            (only runs if the catalog is empty)
//        npm run seed -- --force (adds the slots even if products exist)
const { one, run, tx } = require('../lib/db');

const force = process.argv.includes('--force');
if (!force && one('SELECT COUNT(*) AS n FROM products').n > 0) {
  console.log('Products already exist, so nothing was added. Use `npm run seed -- --force` to add the empty slots anyway.');
  process.exit(0);
}

// [name, slug, description, draft slots, starter options, starter details]
const CATEGORIES = [
  ['Trending Now', 'trending', 'The products everyone is talking about right now.', 2, '', 'Feature 1: …\nFeature 2: …\nWhat’s included: …'],
  ['Clothing', 'clothing', 'Streetwear, essentials and fits for every season.', 3, 'Size: S, M, L, XL\nColor: Black, White', 'Material: …\nFit: True to size\nCare: Machine wash cold'],
  ['Electronics', 'electronics', 'Gadgets, audio and accessories that just work.', 3, '', 'Battery: …\nConnectivity: …\nWhat’s included: …\nWarranty: …'],
  ['Fragrances', 'fragrances', 'Signature scents for every occasion.', 2, '', 'Top notes: …\nHeart notes: …\nBase notes: …\nSize: 100 ml / 3.4 fl oz'],
  ['Home & Living', 'home-living', 'Upgrades for your space.', 1, '', 'Dimensions: …\nMaterial: …'],
  ['Miscellaneous', 'miscellaneous', 'Cool finds that don’t fit anywhere else.', 1, '', 'Details: …'],
];

let total = 0;
tx(() => {
  CATEGORIES.forEach(([name, slug, desc, slots, options, details], i) => {
    run('INSERT OR IGNORE INTO categories (name, slug, description, sort) VALUES (?, ?, ?, ?)', name, slug, desc, i);
    const catId = one('SELECT id FROM categories WHERE slug = ?', slug).id;
    for (let n = 1; n <= slots; n++) {
      total++;
      let pslug = `${slug}-slot-${n}`;
      if (one('SELECT 1 AS x FROM products WHERE slug = ?', pslug)) pslug += '-' + Date.now().toString(36);
      run(`INSERT INTO products (name, slug, description, details, options, price_cents, category_id, images, active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 0, datetime('now', ?))`,
      `${name} product ${n}`, pslug, 'Write a short, punchy description of the product and who it’s for.', details, options, 2999, catId, `-${100 - total} minutes`);
    }
  });
});

console.log(`✓ Added ${CATEGORIES.length} categories and ${total} empty product slots (hidden drafts).`);
console.log('  Dashboard → Products: add each name, photos, price and supplier link, then tick "Active" to publish.');
console.log('  Dashboard → Categories: add as many categories as you like.');
