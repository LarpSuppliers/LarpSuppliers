'use strict';
const { esc, money } = require('../lib/util');
const { all } = require('../lib/db');

const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.2 11.1a2 2 0 0 1-2 1.9H8.2a2 2 0 0 1-2-1.9L5 8Z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h11v10H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"/></svg>',
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12Z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3L12 17.2l-5.6 3 1.1-6.3L2.9 9.5l6.3-.9L12 2.8Z"/></svg>',
};

const logoMark = '<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f6e4bf"/><stop offset="1" stop-color="#b98d4f"/></linearGradient></defs><path d="M16 2.5 28 9v14L16 29.5 4 23V9Z" fill="none" stroke="url(#lg)" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 9l12 6.5L28 9M16 15.5v14" fill="none" stroke="url(#lg)" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 5.8l12 6.5" stroke="url(#lg)" stroke-width="1.6"/></svg>';

function layout({ title, settings: s, body, description, active = '' }) {
  const cats = all('SELECT c.name, c.slug FROM categories c WHERE EXISTS (SELECT 1 FROM products p WHERE p.category_id = c.id AND p.active = 1) ORDER BY c.sort, c.name');
  const pageTitle = title ? `${esc(title)} — ${esc(s.store_name)}` : `${esc(s.store_name)} — ${esc(s.tagline)}`;
  const nav = [['/shop', 'Shop'], ['/shop?deals=1', 'Deals'], ['/about', 'About'], ['/track', 'Track Order'], ['/contact', 'Contact']];
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${pageTitle}</title>
<meta name="description" content="${esc(description || s.tagline)}">
<meta name="theme-color" content="#0b0b0d">
<link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/css/store.css?v=1">
<script src="/static/js/store.js?v=1" defer></script>
</head>
<body data-free-threshold="${esc(s.free_shipping_threshold_cents)}">
${s.announcement ? `<div class="announce">${esc(s.announcement)}</div>` : ''}
<header class="site-header" id="top">
  <div class="container header-inner">
    <button class="icon-btn menu-btn" aria-label="Open menu" data-open-menu>${ICON.menu}</button>
    <a href="/" class="logo">${logoMark}<span>${esc(s.store_name)}</span></a>
    <nav class="main-nav" aria-label="Main">
      <div class="nav-drop">
        <a href="/shop" class="${active === '/shop' ? 'active' : ''}" aria-haspopup="true">Shop <span class="caret">▾</span></a>
        <div class="drop-panel" role="menu">
          <a href="/shop" role="menuitem"><b>All products</b></a>
          ${cats.map((c) => `<a href="/category/${esc(c.slug)}" role="menuitem">${esc(c.name)}</a>`).join('')}
          <a href="/shop?deals=1" role="menuitem" class="drop-deal">Deals</a>
        </div>
      </div>
      ${nav.slice(1).map(([h, l]) => `<a href="${h}" class="${active === h ? 'active' : ''}">${l}</a>`).join('')}
    </nav>
    <div class="header-actions">
      <form class="search-form" action="/shop" method="get" role="search">
        <input type="search" name="q" placeholder="Search products" aria-label="Search products" autocomplete="off">
        <button class="icon-btn" aria-label="Search">${ICON.search}</button>
      </form>
      <button class="icon-btn cart-btn" aria-label="Open cart" data-open-cart>${ICON.bag}<span class="cart-count" data-cart-count hidden>0</span></button>
    </div>
  </div>
</header>
<div class="mobile-menu" data-menu hidden>
  <div class="mobile-menu-panel">
    <button class="icon-btn" aria-label="Close menu" data-close-menu>${ICON.close}</button>
    <form action="/shop" method="get" class="mobile-search"><input type="search" name="q" placeholder="Search products" aria-label="Search"></form>
    ${nav.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}
    <div class="mobile-cats">${cats.map((c) => `<a href="/category/${esc(c.slug)}">${esc(c.name)}</a>`).join('')}</div>
  </div>
</div>
<main id="main">${body}</main>
<footer class="site-footer">
  <div class="container footer-grid">
    <div class="footer-brand">
      <a href="/" class="logo">${logoMark}<span>${esc(s.store_name)}</span></a>
      <p>${esc(s.tagline)}</p>
      <p class="muted small">Support: <a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a></p>
    </div>
    <div><h4>Shop</h4><a href="/shop">All products</a>${cats.slice(0, 5).map((c) => `<a href="/category/${esc(c.slug)}">${esc(c.name)}</a>`).join('')}<a href="/shop?deals=1">Deals</a></div>
    <div><h4>Help</h4><a href="/track">Track your order</a><a href="/shipping">Shipping policy</a><a href="/returns">Returns &amp; refunds</a><a href="/contact">Contact us</a></div>
    <div><h4>Company</h4><a href="/about">About us</a><a href="/privacy">Privacy policy</a><a href="/terms">Terms &amp; conditions</a></div>
  </div>
  <div class="container footer-bottom">
    <span>© ${new Date().getFullYear()} ${esc(s.store_name)}. All rights reserved.</span>
    <span class="pay-note">${ICON.lock} Secure checkout powered by Stripe</span>
  </div>
</footer>
<div class="drawer-backdrop" data-cart-backdrop hidden></div>
<aside class="cart-drawer" data-cart-drawer aria-label="Shopping cart" aria-hidden="true">
  <div class="drawer-head"><h3>Your cart</h3><button class="icon-btn" aria-label="Close cart" data-close-cart>${ICON.close}</button></div>
  <div class="drawer-body" data-drawer-body></div>
  <div class="drawer-foot" data-drawer-foot></div>
</aside>
<div class="toast" data-toast role="status" aria-live="polite"></div>
</body></html>`;
}

function productCard(p, { badge } = {}) {
  let img = '';
  try { img = JSON.parse(p.images)[0] || ''; } catch { /* none */ }
  const onSale = p.compare_at_cents && p.compare_at_cents > p.price_cents;
  const pct = onSale ? Math.round((1 - p.price_cents / p.compare_at_cents) * 100) : 0;
  const b = badge || (onSale ? `−${pct}%` : p.best_seller ? 'Best seller' : '');
  return `<article class="card reveal">
  <a href="/product/${esc(p.slug)}" class="card-media">
    ${img ? `<img src="${esc(img)}" alt="${esc(p.name)}" loading="lazy">` : '<div class="img-ph"></div>'}
    ${b ? `<span class="badge ${onSale ? 'badge-sale' : ''}">${esc(b)}</span>` : ''}
  </a>
  <div class="card-body">
    ${p.category_name ? `<span class="card-cat">${esc(p.category_name)}</span>` : ''}
    <h3 class="card-title"><a href="/product/${esc(p.slug)}">${esc(p.name)}</a></h3>
    <div class="card-foot">
      <div class="price">${money(p.price_cents)}${onSale ? ` <s>${money(p.compare_at_cents)}</s>` : ''}</div>
      ${String(p.options || '').includes(':') ? `<a class="quick-add" href="/product/${esc(p.slug)}" aria-label="Choose options for ${esc(p.name)}">Options</a>` : `<button class="quick-add" data-add-to-cart="${p.id}" aria-label="Add ${esc(p.name)} to cart">${ICON.bag}<span>Add</span></button>`}
    </div>
  </div>
</article>`;
}

function stars(n) {
  return `<span class="stars" aria-label="${n} out of 5 stars">${[1, 2, 3, 4, 5].map((i) => `<span class="${i <= n ? 'on' : ''}">${ICON.star}</span>`).join('')}</span>`;
}

const REVIEW_SOURCES = { order: 'Verified buyer', in_person: 'In-person customer', instagram: 'Via Instagram', tiktok: 'Via TikTok', text: 'Via text message', email: 'Via email', other: 'Customer review' };
const reviewSource = (r) => REVIEW_SOURCES[r.source] || REVIEW_SOURCES.other;

module.exports = { layout, productCard, stars, ICON, logoMark, REVIEW_SOURCES, reviewSource };
