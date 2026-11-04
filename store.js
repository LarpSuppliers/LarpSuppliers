(() => {
  'use strict';
  const KEY = 'cart_v1';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const money = (c) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- Cart storage (ids + quantities only; prices always come from the server) ----------
  const getCart = () => { try { const c = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(c) ? c.filter((i) => i && i.id > 0 && i.qty > 0) : []; } catch { return []; } };
  // Same key format as the server: id|[["Color","Black"],["Size","M"]]
  const keyOf = (l) => `${l.id}|${JSON.stringify(Object.entries(l.opts || {}).sort((a, b) => (a[0] < b[0] ? -1 : 1)))}`;
  const saveCart = (c) => { try { localStorage.setItem(KEY, JSON.stringify(c)); } catch { /* storage unavailable */ } updateCount(); };
  const MAX = 20;

  function addToCart(id, qty = 1, opts = {}) {
    const cart = getCart(); const k = keyOf({ id, opts }); const line = cart.find((l) => keyOf(l) === k);
    if (line) line.qty = Math.min(MAX, line.qty + qty); else cart.push({ id, qty: Math.min(MAX, qty), opts });
    saveCart(cart);
    const badge = $('[data-cart-count]'); if (badge) { badge.classList.remove('bump'); void badge.offsetWidth; badge.classList.add('bump'); }
  }
  function setQty(key, qty) {
    let cart = getCart();
    if (qty <= 0) cart = cart.filter((l) => keyOf(l) !== key); else { const l = cart.find((x) => keyOf(x) === key); if (l) l.qty = Math.min(MAX, qty); }
    saveCart(cart);
  }
  function updateCount() {
    const n = getCart().reduce((a, l) => a + l.qty, 0);
    $$('[data-cart-count]').forEach((b) => { b.textContent = n; b.hidden = n === 0; });
  }

  let pricing = null;
  async function priceCart() {
    const items = getCart();
    if (!items.length) { pricing = { lines: [], subtotal_cents: 0, shipping_cents: 0, total_cents: 0, removed: [] }; return pricing; }
    const res = await fetch('/api/cart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) });
    if (!res.ok) throw new Error('Could not load cart');
    pricing = await res.json();
    if (pricing.removed?.length) { saveCart(getCart().filter((l) => !pricing.removed.includes(keyOf(l)))); toast('An item in your cart is no longer available and was removed'); }
    // keep local quantities in sync with server-capped quantities
    const cart = getCart(); let changed = false;
    for (const l of pricing.lines) { const c = cart.find((x) => keyOf(x) === l.key); if (c && c.qty !== l.quantity) { c.qty = l.quantity; changed = true; } }
    if (changed) saveCart(cart);
    return pricing;
  }

  const lineHtml = (l) => `
    <div class="cart-line" data-line="${esc(l.key)}">
      <a href="/product/${esc(l.slug)}">${l.image ? `<img src="${esc(l.image)}" alt="">` : '<div class="img-ph"></div>'}</a>
      <div>
        <h4><a href="/product/${esc(l.slug)}">${esc(l.name)}</a></h4>
        ${l.options ? `<span class="line-opts">${esc(l.options)}</span>` : ''}<span class="muted small">${money(l.unit_price_cents)} each</span>
        <div class="line-meta">
          <div class="qty sm"><button type="button" data-line-dec="${esc(l.key)}" aria-label="Decrease">−</button><input type="number" min="1" max="${MAX}" value="${l.quantity}" data-line-qty="${esc(l.key)}" aria-label="Quantity"><button type="button" data-line-inc="${esc(l.key)}" aria-label="Increase">+</button></div>
          <button class="remove" data-line-remove="${esc(l.key)}">Remove</button>
        </div>
      </div>
      <div class="line-total">${money(l.line_total_cents)}</div>
    </div>`;

  function freeShipHtml(p) {
    const t = p.free_shipping_threshold_cents || 0;
    if (!t || !p.subtotal_cents) return '';
    if (p.subtotal_cents >= t) return '✓ You\'ve unlocked free shipping';
    const pct = Math.min(100, Math.round((p.subtotal_cents / t) * 100));
    return `Add ${money(t - p.subtotal_cents)} more for free shipping<div class="bar"><i style="width:${pct}%"></i></div>`;
  }

  // ---------- Drawer ----------
  const drawer = $('[data-cart-drawer]'); const backdrop = $('[data-cart-backdrop]');
  async function openDrawer() {
    if (!drawer) return;
    backdrop.hidden = false; requestAnimationFrame(() => backdrop.classList.add('show'));
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden';
    await renderDrawer();
  }
  function closeDrawer() {
    if (!drawer) return;
    drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); backdrop.classList.remove('show'); document.body.style.overflow = '';
    setTimeout(() => { backdrop.hidden = true; }, 300);
  }
  async function renderDrawer() {
    const body = $('[data-drawer-body]'); const foot = $('[data-drawer-foot]');
    if (!body) return;
    try { await priceCart(); } catch { body.innerHTML = '<p class="drawer-empty">Could not load your cart. Please refresh.</p>'; return; }
    if (!pricing.lines.length) {
      body.innerHTML = '<div class="drawer-empty"><p>Your cart is empty.</p><a href="/shop" class="btn btn-primary">Start shopping</a></div>';
      foot.innerHTML = ''; return;
    }
    body.innerHTML = pricing.lines.map(lineHtml).join('');
    foot.innerHTML = `<div class="free-ship">${freeShipHtml(pricing)}</div>
      <div class="sum-row"><span>Subtotal</span><span>${money(pricing.subtotal_cents)}</span></div>
      <div class="sum-row"><span>Shipping</span><span>${pricing.shipping_cents ? money(pricing.shipping_cents) : 'Free'}</span></div>
      <div class="sum-row total"><span>Total</span><span>${money(pricing.total_cents)}</span></div>
      <a href="/checkout" class="btn btn-primary btn-block btn-lg">Checkout</a>
      <a href="/cart" class="btn btn-ghost btn-block">View cart</a>`;
  }

  // ---------- Cart page ----------
  async function renderCartPage() {
    const root = $('[data-cart-page]'); if (!root) return;
    const linesEl = $('[data-cart-lines]'); const sum = $('[data-cart-summary]');
    try { await priceCart(); } catch { linesEl.innerHTML = '<p class="muted">Could not load your cart. Please refresh.</p>'; return; }
    if (!pricing.lines.length) {
      linesEl.innerHTML = '<div class="empty"><h3>Your cart is empty</h3><p class="muted">Looks like you haven\'t added anything yet.</p><a href="/shop" class="btn btn-primary">Continue shopping</a></div>';
      sum.hidden = true; return;
    }
    linesEl.innerHTML = pricing.lines.map(lineHtml).join('');
    sum.hidden = false;
    $('[data-sum-subtotal]', sum).textContent = money(pricing.subtotal_cents);
    $('[data-sum-shipping]', sum).textContent = pricing.shipping_cents ? money(pricing.shipping_cents) : 'Free';
    $('[data-sum-total]', sum).textContent = money(pricing.total_cents);
    $('[data-free-ship]', sum).innerHTML = freeShipHtml(pricing);
  }

  // ---------- Checkout ----------
  async function renderCheckout() {
    const sum = $('[data-checkout-summary]'); if (!sum) return;
    try { await priceCart(); } catch { $('[data-sum-lines]').innerHTML = '<p class="muted">Could not load your cart.</p>'; return; }
    if (!pricing.lines.length) { window.location.href = '/cart'; return; }
    $('[data-sum-lines]').innerHTML = pricing.lines.map((l) => `<div class="sum-line"><div class="thumb">${l.image ? `<img src="${esc(l.image)}" alt="">` : '<div class="img-ph sm"></div>'}<span class="q">${l.quantity}</span></div><span>${esc(l.name)}${l.options ? `<br><small class="muted">${esc(l.options)}</small>` : ''}</span><span>${money(l.line_total_cents)}</span></div>`).join('');
    $('[data-sum-subtotal]', sum).textContent = money(pricing.subtotal_cents);
    $('[data-sum-shipping]', sum).textContent = pricing.shipping_cents ? money(pricing.shipping_cents) : 'Free';
    $('[data-sum-total]', sum).textContent = money(pricing.total_cents);
  }

  const form = $('[data-checkout-form]');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('[data-pay-btn]', form); const errBox = $('[data-form-error]', form);
      $$('.field', form).forEach((f) => f.classList.remove('invalid')); $$('[data-err]', form).forEach((x) => { x.textContent = ''; });
      errBox.hidden = true;
      const data = Object.fromEntries(new FormData(form));
      const original = btn.innerHTML; btn.disabled = true; btn.textContent = 'Redirecting to secure payment…';
      try {
        const res = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: getCart(), customer: data }) });
        const out = await res.json().catch(() => ({}));
        if (res.ok && out.url) { window.location.href = out.url; return; }
        if (out.fields) for (const [k, msg] of Object.entries(out.fields)) { const el = $(`[data-err="${k}"]`, form); if (el) { el.textContent = msg; el.closest('.field')?.classList.add('invalid'); } }
        if (out.removed) { saveCart(getCart().filter((l) => !out.removed.includes(keyOf(l)))); renderCheckout(); }
        errBox.textContent = out.error || 'Something went wrong. Please try again.'; errBox.hidden = false;
        const firstBad = $('.field.invalid input, .field.invalid select', form); if (firstBad) firstBad.focus();
      } catch {
        errBox.textContent = 'Network error. Please check your connection and try again.'; errBox.hidden = false;
      }
      btn.disabled = false; btn.innerHTML = original;
    });
  }

  // Reads the chosen options on a product page. Returns null (and highlights) if one is missing.
  function readOptions() {
    const opts = {}; let missing = null;
    $$('[data-option]').forEach((g) => { if (g.dataset.selected) opts[g.dataset.option] = g.dataset.selected; else { g.classList.add('missing'); missing ||= g.dataset.option; } });
    if (missing) { toast(`Please choose a ${esc(missing.toLowerCase())}`); return null; }
    return opts;
  }

  // ---------- Toast ----------
  let toastTimer;
  function toast(html) {
    const t = $('[data-toast]'); if (!t) return;
    t.innerHTML = html; t.classList.add('show'); clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Events ----------
  const rerender = () => Promise.all([drawer?.classList.contains('open') ? renderDrawer() : null, renderCartPage()]);
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('button, a'); if (!t) return;
    if (t.matches('[data-add-to-cart]')) {
      e.preventDefault();
      const id = Number(t.dataset.addToCart);
      const onPage = t.hasAttribute('data-with-qty');
      const opts = onPage ? readOptions() : {};
      if (!opts) return;
      const qty = Math.max(1, Math.min(MAX, Number((onPage ? $('[data-qty-input]') : null)?.value) || 1));
      addToCart(id, qty, opts);
      $('[data-toast]')?.classList.remove('show');
      t.classList.add('added'); setTimeout(() => t.classList.remove('added'), 800);
      openDrawer();
    } else if (t.matches('[data-buy-now]')) {
      const opts = readOptions(); if (!opts) return;
      const qty = Math.max(1, Math.min(MAX, Number($('[data-qty-input]')?.value) || 1));
      addToCart(Number(t.dataset.buyNow), qty, opts); window.location.href = '/checkout';
    } else if (t.matches('[data-opt-value]')) {
      const g = t.closest('[data-option]');
      $$('[data-opt-value]', g).forEach((b) => b.classList.toggle('selected', b === t));
      g.dataset.selected = t.dataset.optValue; g.classList.remove('missing');
      const cur = $('[data-opt-current]', g); if (cur) cur.textContent = t.dataset.optValue;
    } else if (t.matches('[data-open-cart]')) { openDrawer(); }
    else if (t.matches('[data-close-cart]')) { closeDrawer(); }
    else if (t.matches('[data-line-inc], [data-line-dec]')) {
      const key = t.dataset.lineInc || t.dataset.lineDec;
      const cur = getCart().find((l) => keyOf(l) === key)?.qty || 1;
      setQty(key, cur + (t.dataset.lineInc ? 1 : -1)); rerender();
    } else if (t.matches('[data-line-remove]')) { setQty(t.dataset.lineRemove, 0); toast('Item removed'); rerender(); }
    else if (t.matches('[data-qty-inc], [data-qty-dec]')) {
      const input = $('[data-qty-input]'); input.value = Math.max(1, Math.min(MAX, (Number(input.value) || 1) + (t.matches('[data-qty-inc]') ? 1 : -1)));
    } else if (t.matches('[data-gallery-thumb]')) {
      const main = $('[data-gallery-main]'); main.style.opacity = 0;
      setTimeout(() => { main.src = t.dataset.galleryThumb; main.style.opacity = 1; }, 150);
      $$('[data-gallery-thumb]').forEach((b) => b.classList.toggle('active', b === t));
    } else if (t.matches('[data-open-menu]')) { $('[data-menu]').hidden = false; }
    else if (t.matches('[data-close-menu]')) { $('[data-menu]').hidden = true; }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-line-qty]')) { setQty(t.dataset.lineQty, Math.max(1, Math.min(MAX, Number(t.value) || 1))); rerender(); }
    if (t.matches('[data-autosubmit]')) t.form.submit();
  });
  backdrop?.addEventListener('click', closeDrawer);
  $('[data-menu]')?.addEventListener('click', (e) => { if (e.target.matches('[data-menu]')) e.target.hidden = true; });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); const m = $('[data-menu]'); if (m) m.hidden = true; } });
  window.addEventListener('storage', (e) => { if (e.key === KEY) { updateCount(); renderCartPage(); } });

  // Reveal on scroll
  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -40px 0px' }) : null;
  $$('.reveal').forEach((el, i) => { if (io) { if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', `${(i % 4) * 70}ms`); io.observe(el); } else el.classList.add('in'); });

  // Order confirmed → clear cart
  if ($('[data-clear-cart]')) saveCart([]);

  updateCount();
  renderCartPage();
  renderCheckout();
})();
