'use strict';
const { esc, money, fmtDay, fmtDate } = require('../lib/util');
const { layout, productCard, stars, ICON, reviewSource } = require('./layout');
const { US_STATES } = require('../lib/orders');
const { parseOptions } = require('../lib/options');

const section = (title, sub, link, products, opts = {}) => (products.length ? `
<section class="section">
  <div class="container">
    <div class="section-head reveal"><div><span class="eyebrow">${esc(sub)}</span><h2>${esc(title)}</h2></div>${link ? `<a href="${link}" class="link-arrow">View all ${ICON.arrow}</a>` : ''}</div>
    <div class="grid ${opts.scroll ? 'grid-scroll' : ''}">${products.map((p) => productCard(p, opts)).join('')}</div>
  </div>
</section>` : '');

function home({ settings: s, featured, bestSellers, newArrivals, deals, categories, reviews, heroProduct }) {
  let heroImg = '';
  try { heroImg = heroProduct ? JSON.parse(heroProduct.images)[0] : ''; } catch { /* none */ }
  const body = `
<section class="hero">
  <div class="hero-glow"></div>
  <div class="container hero-inner">
    <div class="hero-copy">
      <span class="eyebrow reveal">New drops every week</span>
      <h1 class="reveal">Everything you want.<br><span class="grad">All in one place.</span></h1>
      <p class="lead reveal">Clothing, electronics, trending finds and more, hand-picked by ${esc(s.store_name)} and shipped straight to your door.</p>
      <div class="hero-cta reveal">
        <a href="/shop" class="btn btn-primary btn-lg">Shop Now ${ICON.arrow}</a>
        <a href="/shop?deals=1" class="btn btn-ghost btn-lg">View deals</a>
      </div>
      <ul class="hero-points reveal">
        <li>${ICON.lock} Secure Stripe checkout</li>
        <li>${ICON.truck} Tracked shipping</li>
        <li>${ICON.refresh} 30-day returns</li>
      </ul>
    </div>
    ${heroProduct && heroImg ? `<a href="/product/${esc(heroProduct.slug)}" class="hero-visual reveal">
      <div class="hero-card"><img src="${esc(heroImg)}" alt="${esc(heroProduct.name)}"></div>
      <div class="hero-tag"><span>${esc(heroProduct.name)}</span><b>${money(heroProduct.price_cents)}</b></div>
    </a>` : ''}
  </div>
</section>

${categories.length ? `<section class="section">
  <div class="container">
    <div class="section-head reveal"><div><span class="eyebrow">Browse</span><h2>Shop by category</h2></div></div>
    <div class="cat-grid">${categories.map((c, i) => `<a href="/category/${esc(c.slug)}" class="cat-tile reveal" style="--d:${i * 60}ms">
      ${c.image ? `<img src="${esc(c.image)}" alt="" loading="lazy">` : ''}<div class="cat-label"><b>${esc(c.name)}</b><span>${c.count} product${c.count === 1 ? '' : 's'}</span></div></a>`).join('')}
    </div>
  </div>
</section>` : ''}

${section('Featured products', 'Hand-picked', '/shop?sort=featured', featured)}
${section('Best sellers', 'Customer favorites', '/shop?sort=featured', bestSellers, { badge: 'Best seller' })}
${deals.length ? `<section class="section deals-band"><div class="container">
  <div class="section-head reveal"><div><span class="eyebrow">Limited time</span><h2>Special deals</h2></div><a href="/shop?deals=1" class="link-arrow">All deals ${ICON.arrow}</a></div>
  <div class="grid">${deals.map((p) => productCard(p)).join('')}</div></div></section>` : ''}
${section('New arrivals', 'Just landed', '/shop?sort=newest', newArrivals, { badge: 'New' })}

<section class="section">
  <div class="container values">
    <div class="value reveal">${ICON.truck}<h3>Transparent shipping</h3><p>Orders are processed in ${esc(s.processing_time)} and delivered in ${esc(s.delivery_time)}. Every order gets a tracking number.</p></div>
    <div class="value reveal">${ICON.lock}<h3>Secure payments</h3><p>Checkout is handled by Stripe. We never see or store your card details.</p></div>
    <div class="value reveal">${ICON.refresh}<h3>Easy returns</h3><p>Not right? Contact us within 30 days of delivery and we'll make it right.</p></div>
    <div class="value reveal">${ICON.chat}<h3>Real support</h3><p>Questions about an order? Our team replies within one business day.</p></div>
  </div>
</section>

<section class="section">
  <div class="container">
    <div class="section-head reveal"><div><span class="eyebrow">Reviews</span><h2>What customers are saying</h2></div></div>
    ${reviews.length ? `<div class="reviews">${reviews.map((r) => `<figure class="review reveal">${stars(r.rating)}<blockquote>${esc(r.body)}</blockquote>
      <figcaption><b>${esc(r.name)}</b>${r.product_name ? ` · <a href="/product/${esc(r.product_slug)}">${esc(r.product_name)}</a>` : ''}<span class="verified ${r.source === 'order' ? '' : 'other'}">${esc(reviewSource(r))}</span></figcaption></figure>`).join('')}</div>`
    : `<div class="empty-reviews reveal"><p>We're a new store and our first customer reviews are on the way. Every review shown here comes from a real customer.</p><a href="/shop" class="btn btn-ghost">Be one of our first customers</a></div>`}
  </div>
</section>`;
  return layout({ settings: s, body, active: '/' });
}

function shop({ settings: s, products, categories, q, category, sort, min, max, deals, total }) {
  const qs = (over) => {
    const p = new URLSearchParams({ ...(q && { q }), ...(sort && { sort }), ...(min && { min }), ...(max && { max }), ...(deals && { deals: '1' }), ...over });
    for (const [k, v] of [...p]) if (!v) p.delete(k);
    const str = p.toString(); return str ? '?' + str : '';
  };
  const base = category ? `/category/${esc(category.slug)}` : '/shop';
  const title = category ? category.name : q ? `Results for “${q}”` : deals ? 'Special deals' : 'All products';
  const body = `
<section class="page-hero"><div class="container">
  <nav class="crumbs"><a href="/">Home</a><span>/</span><a href="/shop">Shop</a>${category ? `<span>/</span>${esc(category.name)}` : ''}</nav>
  <h1>${esc(title)}</h1>${category?.description ? `<p class="lead">${esc(category.description)}</p>` : ''}
</div></section>
<section class="section pt-0"><div class="container shop-layout">
  <aside class="filters">
    <form method="get" action="${base}" class="filter-form">
      <div class="filter-group"><label for="fq">Search</label><input id="fq" type="search" name="q" value="${esc(q || '')}" placeholder="Search products"></div>
      <div class="filter-group"><span class="label">Category</span>
        <a href="/shop${qs({})}" class="${!category ? 'active' : ''}">All products</a>
        ${categories.map((c) => `<a href="/category/${esc(c.slug)}${qs({})}" class="${category?.id === c.id ? 'active' : ''}">${esc(c.name)} <span class="muted">${c.count}</span></a>`).join('')}
      </div>
      <div class="filter-group"><span class="label">Price</span>
        <div class="price-range"><input type="number" name="min" min="0" step="1" placeholder="Min" value="${esc(min || '')}" aria-label="Minimum price"><span>–</span><input type="number" name="max" min="0" step="1" placeholder="Max" value="${esc(max || '')}" aria-label="Maximum price"></div>
      </div>
      <label class="check"><input type="checkbox" name="deals" value="1" ${deals ? 'checked' : ''}> On sale only</label>
      <input type="hidden" name="sort" value="${esc(sort || '')}">
      <button class="btn btn-primary btn-block">Apply filters</button>
      ${q || min || max || deals ? `<a href="${base}" class="btn btn-ghost btn-block">Clear</a>` : ''}
    </form>
  </aside>
  <div>
    <div class="shop-toolbar">
      <span class="muted">${total} product${total === 1 ? '' : 's'}</span>
      <form method="get" action="${base}" class="sort-form">
        ${q ? `<input type="hidden" name="q" value="${esc(q)}">` : ''}${min ? `<input type="hidden" name="min" value="${esc(min)}">` : ''}${max ? `<input type="hidden" name="max" value="${esc(max)}">` : ''}${deals ? '<input type="hidden" name="deals" value="1">' : ''}
        <label for="sort" class="muted">Sort</label>
        <select id="sort" name="sort" data-autosubmit>
          ${[['featured', 'Featured'], ['newest', 'Newest'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['name', 'Name A–Z']].map(([v, l]) => `<option value="${v}" ${sort === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
      </form>
    </div>
    ${products.length ? `<div class="grid grid-3">${products.map((p) => productCard(p)).join('')}</div>`
    : `<div class="empty"><h3>No products found</h3><p class="muted">Try a different search or clear your filters.</p><a href="/shop" class="btn btn-ghost">View all products</a></div>`}
  </div>
</div></section>`;
  return layout({ settings: s, body, title, active: deals ? '/shop?deals=1' : '/shop' });
}

function product({ settings: s, p, images, related, reviews = [] }) {
  const onSale = p.compare_at_cents && p.compare_at_cents > p.price_cents;
  const details = String(p.details || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const body = `
<section class="section product-page"><div class="container">
  <nav class="crumbs"><a href="/">Home</a><span>/</span><a href="/shop">Shop</a>${p.category_slug ? `<span>/</span><a href="/category/${esc(p.category_slug)}">${esc(p.category_name)}</a>` : ''}</nav>
  <div class="product-layout">
    <div class="gallery" data-gallery>
      <div class="gallery-main">${images[0] ? `<img src="${esc(images[0])}" alt="${esc(p.name)}" data-gallery-main>` : '<div class="img-ph"></div>'}</div>
      ${images.length > 1 ? `<div class="gallery-thumbs">${images.map((im, i) => `<button class="${i === 0 ? 'active' : ''}" data-gallery-thumb="${esc(im)}" aria-label="View image ${i + 1}"><img src="${esc(im)}" alt=""></button>`).join('')}</div>` : ''}
    </div>
    <div class="product-info">
      ${p.category_name ? `<span class="eyebrow">${esc(p.category_name)}</span>` : ''}
      <h1>${esc(p.name)}</h1>
      <div class="product-price">${money(p.price_cents)}${onSale ? ` <s>${money(p.compare_at_cents)}</s> <span class="badge badge-sale">Save ${money(p.compare_at_cents - p.price_cents)}</span>` : ''}</div>
      <p class="product-desc">${esc(p.description)}</p>
      ${parseOptions(p.options).map((o) => `<div class="opt-group" data-option="${esc(o.name)}"${o.values.length === 1 ? ` data-selected="${esc(o.values[0])}"` : ''}>
        <span class="opt-label">${esc(o.name)}: <b data-opt-current>${o.values.length === 1 ? esc(o.values[0]) : 'Select'}</b></span>
        <div class="opt-values">${o.values.map((v) => `<button type="button" class="${o.values.length === 1 ? 'selected' : ''}" data-opt-value="${esc(v)}">${esc(v)}</button>`).join('')}</div>
      </div>`).join('')}
      <div class="buy-box">
        <div class="qty" data-qty>
          <button type="button" aria-label="Decrease quantity" data-qty-dec>−</button>
          <input type="number" min="1" max="20" value="1" aria-label="Quantity" data-qty-input>
          <button type="button" aria-label="Increase quantity" data-qty-inc>+</button>
        </div>
        <button class="btn btn-primary btn-lg grow" data-add-to-cart="${p.id}" data-with-qty>Add to Cart</button>
      </div>
      <button class="btn btn-ghost btn-block" data-buy-now="${p.id}">Buy it now</button>
      <ul class="ship-info">
        <li>${ICON.truck}<div><b>Ships in ${esc(s.processing_time)}</b><span>Estimated delivery ${esc(s.delivery_time)} after dispatch, with tracking.</span></div></li>
        <li>${ICON.refresh}<div><b>30-day returns</b><span>See our <a href="/returns">return policy</a>.</span></div></li>
        <li>${ICON.lock}<div><b>Secure checkout</b><span>Payments processed by Stripe.</span></div></li>
      </ul>
      ${details.length ? `<details class="accordion" open><summary>Product details</summary><ul class="details-list">${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul></details>` : ''}
      <details class="accordion"><summary>Shipping &amp; returns</summary><p>Orders are processed within ${esc(s.processing_time)}. Delivery typically takes ${esc(s.delivery_time)}. Shipping is ${Number(s.free_shipping_threshold_cents) > 0 ? `free on orders over ${money(s.free_shipping_threshold_cents)}, otherwise ` : ''}${money(s.shipping_flat_cents)}. <a href="/shipping">Full shipping policy</a>.</p></details>
    </div>
  </div>
</div></section>
<section class="section pt-0" id="reviews"><div class="container">
  <div class="section-head"><div><span class="eyebrow">Reviews</span><h2>${reviews.length ? `${(reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1)} out of 5` : 'Customer reviews'}</h2>${reviews.length ? `<p class="muted">${stars(Math.round(reviews.reduce((a, r) => a + r.rating, 0) / reviews.length))} Based on ${reviews.length} review${reviews.length === 1 ? '' : 's'}</p>` : ''}</div></div>
  ${reviews.length ? `<div class="reviews">${reviews.map((r) => `<figure class="review">${stars(r.rating)}<blockquote>${esc(r.body)}</blockquote><figcaption><b>${esc(r.name)}</b><span class="verified ${r.source === 'order' ? '' : 'other'}">${esc(reviewSource(r))}</span></figcaption></figure>`).join('')}</div>`
  : '<div class="empty-reviews"><p>No reviews yet. Customers can review this product after their order is delivered.</p></div>'}
</div></section>
${related.length ? `<section class="section"><div class="container"><div class="section-head"><div><span class="eyebrow">You may also like</span><h2>Related products</h2></div></div><div class="grid">${related.map((r) => productCard(r)).join('')}</div></div></section>` : ''}`;
  return layout({ settings: s, body, title: p.name, description: p.description.slice(0, 160) });
}

function cart({ settings: s }) {
  const body = `
<section class="page-hero"><div class="container"><h1>Shopping cart</h1></div></section>
<section class="section pt-0"><div class="container cart-layout" data-cart-page>
  <div class="cart-lines" data-cart-lines><div class="loading">Loading your cart…</div></div>
  <aside class="summary" data-cart-summary hidden>
    <h3>Order summary</h3>
    <div class="sum-row"><span>Subtotal</span><span data-sum-subtotal>—</span></div>
    <div class="sum-row"><span>Shipping</span><span data-sum-shipping>—</span></div>
    <div class="free-ship" data-free-ship></div>
    <div class="sum-row total"><span>Total</span><span data-sum-total>—</span></div>
    <a href="/checkout" class="btn btn-primary btn-block btn-lg">Proceed to checkout</a>
    <a href="/shop" class="btn btn-ghost btn-block">Continue shopping</a>
    <p class="muted small center">${ICON.lock} Secure checkout with Stripe</p>
  </aside>
</div></section>`;
  return layout({ settings: s, body, title: 'Cart' });
}

function checkout({ settings: s, stripeReady, testMode }) {
  const field = (name, label, attrs = '', full = false) => `<div class="field ${full ? 'full' : ''}"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" ${attrs}><span class="err" data-err="${name}"></span></div>`;
  const body = `
<section class="page-hero"><div class="container"><h1>Checkout</h1></div></section>
<section class="section pt-0"><div class="container checkout-layout">
  <form class="checkout-form" data-checkout-form novalidate>
    ${!stripeReady ? '<div class="alert alert-warn">Payments are not configured yet. The store owner needs to add Stripe keys before orders can be placed.</div>' : ''}
    ${testMode ? '<div class="alert alert-info"><b>Test mode:</b> use card 4242 4242 4242 4242, any future date, any CVC. No real money is charged.</div>' : ''}
    <h3>Contact</h3>
    <div class="form-grid">
      ${field('email', 'Email address', 'type="email" autocomplete="email" required', true)}
    </div>
    <h3>Shipping address</h3>
    <div class="form-grid">
      ${field('name', 'Full name', 'autocomplete="name" required', true)}
      ${field('address1', 'Street address', 'autocomplete="address-line1" required', true)}
      ${field('address2', 'Apartment, suite, etc. (optional)', 'autocomplete="address-line2"', true)}
      ${field('city', 'City', 'autocomplete="address-level2" required')}
      <div class="field"><label for="f-state">State</label><select id="f-state" name="state" autocomplete="address-level1" required><option value="">Select…</option>${US_STATES.map((st) => `<option>${st}</option>`).join('')}</select><span class="err" data-err="state"></span></div>
      ${field('zip', 'ZIP code', 'autocomplete="postal-code" inputmode="numeric" required')}
      ${field('phone', 'Phone (optional, for delivery updates)', 'type="tel" autocomplete="tel"')}
    </div>
    <p class="muted small">We currently ship within the United States. Orders are processed in ${esc(s.processing_time)} and delivered in ${esc(s.delivery_time)}.</p>
    <div class="alert alert-error" data-form-error hidden></div>
    <button class="btn btn-primary btn-lg btn-block" data-pay-btn ${stripeReady ? '' : 'disabled'}>${ICON.lock} Continue to secure payment</button>
    <p class="muted small center">You'll enter your card details on Stripe's secure page. By placing an order you agree to our <a href="/terms">terms</a>.</p>
  </form>
  <aside class="summary" data-checkout-summary>
    <h3>Order summary</h3>
    <div class="sum-lines" data-sum-lines><div class="loading">Loading…</div></div>
    <div class="sum-row"><span>Subtotal</span><span data-sum-subtotal>—</span></div>
    <div class="sum-row"><span>Shipping</span><span data-sum-shipping>—</span></div>
    <div class="sum-row total"><span>Total</span><span data-sum-total>—</span></div>
    <a href="/cart" class="muted small">← Edit cart</a>
  </aside>
</div></section>`;
  return layout({ settings: s, body, title: 'Checkout' });
}

const STATUS_STEPS = ['Paid', 'Purchased', 'Shipped', 'Delivered'];
function customerStatusLabel(status) {
  return { 'Awaiting Payment': 'Awaiting payment', Paid: 'Order received', 'Awaiting Purchase': 'Processing', Purchased: 'Processing', Shipped: 'Shipped', Delivered: 'Delivered', Cancelled: 'Cancelled', Refunded: 'Refunded' }[status] || status;
}
function stepIndex(status) {
  return { Paid: 0, 'Awaiting Purchase': 0, Purchased: 1, Shipped: 2, Delivered: 3 }[status] ?? -1;
}

function orderSummaryBlock(order, items, { showTracking = true } = {}) {
  const idx = stepIndex(order.status);
  const labels = ['Order placed', 'Processing', 'Shipped', 'Delivered'];
  return `
  <div class="order-box">
    <div class="order-box-head"><div><span class="muted small">Order</span><h3>${esc(order.order_number)}</h3></div><span class="pill pill-${esc(order.status.toLowerCase().replace(/\s+/g, '-'))}">${esc(customerStatusLabel(order.status))}</span></div>
    ${idx >= 0 ? `<ol class="progress">${labels.map((l, i) => `<li class="${i <= idx ? 'done' : ''}"><span></span>${l}</li>`).join('')}</ol>` : ''}
    ${showTracking && order.tracking_number ? `<div class="tracking"><div><span class="muted small">Carrier</span><b>${esc(order.tracking_carrier || '—')}</b></div><div><span class="muted small">Tracking number</span><b>${esc(order.tracking_number)}</b></div>${order.tracking_url ? `<a class="btn btn-primary" href="${esc(order.tracking_url)}" target="_blank" rel="noopener noreferrer">Track package</a>` : ''}</div>` : ''}
    <div class="order-items">${items.map((i) => `<div class="oi">${i.image ? `<img src="${esc(i.image)}" alt="">` : '<div class="img-ph sm"></div>'}<div><b>${esc(i.name)}</b>${i.options ? `<span class="line-opts">${esc(i.options)}</span>` : ''}<span class="muted">Qty ${i.quantity}</span></div><span>${money(i.unit_price_cents * i.quantity)}</span></div>`).join('')}</div>
    <div class="sum-row"><span>Subtotal</span><span>${money(order.subtotal_cents)}</span></div>
    <div class="sum-row"><span>Shipping</span><span>${order.shipping_cents ? money(order.shipping_cents) : 'Free'}</span></div>
    <div class="sum-row total"><span>Total</span><span>${money(order.total_cents)}</span></div>
    <div class="ship-to"><span class="muted small">Shipping to</span><p>${esc(order.customer_name)}<br>${esc(order.city)}, ${esc(order.state)} ${esc(order.zip)}</p></div>
    <p class="muted small">Placed ${fmtDate(order.created_at)}</p>
  </div>`;
}

function success({ settings: s, order, items, pending }) {
  const body = `
<section class="section"><div class="container narrow center-col">
  ${pending || !order ? `<div class="success-icon pending">…</div><h1>Confirming your payment</h1>
    <p class="lead">We're waiting for confirmation from our payment processor. This usually takes a few seconds.</p>
    <p class="muted">This page will refresh automatically. You'll also receive a confirmation email.</p>
    <meta http-equiv="refresh" content="4">`
  : `<div class="success-icon" data-clear-cart>✓</div><h1>Thank you, ${esc(order.customer_name.split(' ')[0])}!</h1>
    <p class="lead">Your payment was successful and your order is confirmed. A confirmation email is on its way to <b>${esc(order.email)}</b>.</p>
    <p class="muted">Orders are processed in ${esc(s.processing_time)}. We'll email your tracking number as soon as it ships (typical delivery: ${esc(s.delivery_time)}).</p>
    ${orderSummaryBlock(order, items)}
    <div class="row-gap"><a href="/track?order=${esc(order.order_number)}" class="btn btn-ghost">Track this order</a><a href="/shop" class="btn btn-primary">Continue shopping</a></div>`}
</div></section>`;
  return layout({ settings: s, body, title: 'Order confirmed' });
}

function cancel({ settings: s }) {
  const body = `<section class="section"><div class="container narrow center-col">
    <h1>Payment not completed</h1><p class="lead">No charge was made. Your cart is still saved, so you can pick up where you left off.</p>
    <div class="row-gap"><a href="/checkout" class="btn btn-primary">Return to checkout</a><a href="/cart" class="btn btn-ghost">View cart</a></div>
  </div></section>`;
  return layout({ settings: s, body, title: 'Checkout cancelled' });
}

function track({ settings: s, order, items, error, values = {}, reviewed, reviewMsg }) {
  const body = `
<section class="page-hero"><div class="container"><h1>Track your order</h1><p class="lead">Enter your order number and the email you used at checkout.</p></div></section>
<section class="section pt-0"><div class="container narrow">
  <form method="post" action="/track" class="card-form">
    <div class="form-grid">
      <div class="field"><label for="t-order">Order number</label><input id="t-order" name="order" placeholder="ORD-XXXX-XXXX" value="${esc(values.order || '')}" required></div>
      <div class="field"><label for="t-email">Email</label><input id="t-email" type="email" name="email" value="${esc(values.email || '')}" required></div>
    </div>
    ${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}
    <button class="btn btn-primary">Find my order</button>
  </form>
  ${order ? orderSummaryBlock(order, items) : ''}
  ${order && order.status === 'Delivered' ? (reviewed ? `<div class="alert alert-info">${esc(reviewMsg || 'Thanks for your review!')}</div>` : `
  <form method="post" action="/review" class="card-form">
    <h3>How was your order?</h3>
    <input type="hidden" name="order" value="${esc(order.order_number)}"><input type="hidden" name="email" value="${esc(order.email)}">
    <div class="form-grid">
      <div class="field"><label for="r-name">Display name</label><input id="r-name" name="name" maxlength="60" value="${esc(order.customer_name.split(' ')[0] + ' ' + (order.customer_name.split(' ')[1] || '').slice(0, 1) + '.')}" required></div>
      <div class="field"><label for="r-rating">Rating</label><select id="r-rating" name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</option>`).join('')}</select></div>
      <div class="field full"><label for="r-product">Product</label><select id="r-product" name="product_id">${items.map((i) => `<option value="${i.product_id || ''}">${esc(i.name)}</option>`).join('')}</select></div>
      <div class="field full"><label for="r-body">Your review</label><textarea id="r-body" name="body" rows="4" maxlength="1000" required></textarea></div>
    </div>
    <button class="btn btn-primary">Submit review</button><p class="muted small">Reviews are checked before they're published.</p>
  </form>`) : ''}
</div></section>`;
  return layout({ settings: s, body, title: 'Track order', active: '/track' });
}

function contact({ settings: s, sent, error, values = {} }) {
  const body = `
<section class="page-hero"><div class="container"><h1>Contact us</h1><p class="lead">We're here to help. We reply within one business day.</p></div></section>
<section class="section pt-0"><div class="container contact-layout">
  <div>
    ${sent ? '<div class="alert alert-info">Thanks — your message has been sent. We\'ll get back to you shortly.</div>' : ''}
    ${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}
    <form method="post" action="/contact" class="card-form">
      <div class="form-grid">
        <div class="field"><label for="c-name">Name</label><input id="c-name" name="name" value="${esc(values.name || '')}" maxlength="100" required></div>
        <div class="field"><label for="c-email">Email</label><input id="c-email" type="email" name="email" value="${esc(values.email || '')}" maxlength="200" required></div>
        <div class="field"><label for="c-order">Order number (optional)</label><input id="c-order" name="order_number" value="${esc(values.order_number || '')}" maxlength="30"></div>
        <div class="field"><label for="c-subject">Subject</label><select id="c-subject" name="subject">${['Order question', 'Shipping & tracking', 'Returns & refunds', 'Product question', 'Other'].map((o) => `<option ${values.subject === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
        <div class="field full"><label for="c-body">Message</label><textarea id="c-body" name="body" rows="6" maxlength="4000" required>${esc(values.body || '')}</textarea></div>
        <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      </div>
      <button class="btn btn-primary">Send message</button>
    </form>
  </div>
  <aside class="contact-aside">
    <div class="value">${ICON.chat}<h3>Email</h3><p><a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a></p></div>
    <div class="value">${ICON.truck}<h3>Where's my order?</h3><p>Use <a href="/track">order tracking</a> with your order number and email.</p></div>
    ${s.business_address ? `<div class="value"><h3>Business address</h3><p>${esc(s.business_address).replace(/\n/g, '<br>')}</p></div>` : ''}
  </aside>
</div></section>`;
  return layout({ settings: s, body, title: 'Contact', active: '/contact' });
}

function page({ settings: s, title, html, active }) {
  const body = `<section class="page-hero"><div class="container narrow"><h1>${esc(title)}</h1></div></section>
<section class="section pt-0"><div class="container narrow prose">${html}</div></section>`;
  return layout({ settings: s, body, title, active });
}

function notFound({ settings: s }) {
  return layout({ settings: s, title: 'Page not found', body: `<section class="section"><div class="container narrow center-col"><span class="eyebrow">404</span><h1>Page not found</h1><p class="lead">The page you're looking for doesn't exist or has moved.</p><div class="row-gap"><a href="/" class="btn btn-ghost">Home</a><a href="/shop" class="btn btn-primary">Shop all products</a></div></div></section>` });
}

module.exports = { home, shop, product, cart, checkout, success, cancel, track, contact, page, notFound };
