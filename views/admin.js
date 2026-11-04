'use strict';
const { esc, money, fmtDate, fmtDay, centsToInput } = require('../lib/util');
const { logoMark, REVIEW_SOURCES } = require('./layout');
const { STATUSES } = require('../lib/orders');

const MAX_IMAGES = 8;

const statusClass = (s) => 'st-' + String(s).toLowerCase().replace(/\s+/g, '-');
const pill = (s) => `<span class="status ${statusClass(s)}">${esc(s)}</span>`;
const csrfField = (t) => `<input type="hidden" name="_csrf" value="${esc(t)}">`;

function adminLayout({ title, session, body, active, flash, settings }) {
  const nav = [
    ['/admin', 'Dashboard', 'M3 12h7V3H3zM14 21h7v-9h-7zM14 3v5h7V3zM3 21h7v-5H3z'],
    ['/admin/orders', 'Orders', 'M4 4h16v16H4zM8 9h8M8 13h8M8 17h5'],
    ['/admin/products', 'Products', 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8'],
    ['/admin/categories', 'Categories', 'M4 6h16M4 12h16M4 18h10'],
    ['/admin/messages', 'Messages', 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12Z'],
    ['/admin/reviews', 'Reviews', 'm12 3 2.6 5.6 6 .8-4.4 4.2 1 6L12 16.8 6.8 19.6l1-6L3.4 9.4l6-.8z'],
    ['/admin/settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z'],
  ];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>${esc(title)} · Admin</title>
<link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/static/css/admin.css?v=1"><script src="/static/js/admin.js?v=1" defer></script></head>
<body data-csrf="${esc(session?.csrf || '')}">
<div class="admin">
  <aside class="side">
    <a href="/admin" class="brand">${logoMark}<span>${esc(settings?.store_name || 'Store')}<small>Admin</small></span></a>
    <nav>${nav.map(([h, l, d]) => `<a href="${h}" class="${active === h ? 'active' : ''}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>${l}</a>`).join('')}</nav>
    <div class="side-foot">
      <a href="/" target="_blank" rel="noopener">View store ↗</a>
      <a href="/admin/account">${esc(session?.name || '')}</a>
      <form method="post" action="/admin/logout">${csrfField(session?.csrf)}<button class="linklike">Log out</button></form>
    </div>
  </aside>
  <main class="content">
    ${flash ? `<div class="flash flash-${esc(flash.type || 'ok')}" data-flash>${esc(flash.msg)}</div>` : ''}
    ${body}
  </main>
</div></body></html>`;
}

function login({ error, settings }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Admin login</title><link rel="icon" href="/static/img/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/static/css/admin.css?v=1"></head>
<body class="login-body"><form method="post" action="/admin/login" class="login-card">
  <div class="brand">${logoMark}<span>${esc(settings.store_name)}<small>Owner dashboard</small></span></div>
  ${error ? `<div class="flash flash-error">${esc(error)}</div>` : ''}
  <label>Email<input type="email" name="email" autocomplete="username" required autofocus></label>
  <label>Password<input type="password" name="password" autocomplete="current-password" required></label>
  <button class="btn btn-primary btn-block">Sign in</button>
  <p class="muted small">Private area. Access is limited to store owners.</p>
</form></body></html>`;
}

function kpi(label, value, sub, tone = '') {
  return `<div class="kpi ${tone}"><span>${esc(label)}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
}

function revenueChart(days) {
  const W = 720; const H = 180; const pad = 24; const max = Math.max(1, ...days.map((d) => d.revenue));
  const bw = (W - pad * 2) / days.length;
  const bars = days.map((d, i) => {
    const h = Math.round((d.revenue / max) * (H - pad * 2));
    return `<g><rect x="${(pad + i * bw + 2).toFixed(1)}" y="${H - pad - h}" width="${(bw - 4).toFixed(1)}" height="${Math.max(h, 1)}" rx="3" class="${d.revenue ? 'bar' : 'bar0'}"><title>${esc(d.label)}: ${money(d.revenue)} (${d.orders} orders)</title></rect></g>`;
  }).join('');
  const labels = days.map((d, i) => (i % 5 === 0 || i === days.length - 1 ? `<text x="${(pad + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(d.short)}</text>` : '')).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Revenue, last 30 days"><line x1="${pad}" x2="${W - pad}" y1="${H - pad}" y2="${H - pad}" class="axis"/>${bars}${labels}</svg>`;
}

function ordersTable(orders, { compact } = {}) {
  if (!orders.length) return '<div class="empty">No orders here yet.</div>';
  return `<div class="table-wrap"><table class="table">
  <thead><tr><th>Order</th><th>Date</th><th>Customer</th>${compact ? '' : '<th>Items</th>'}<th>Status</th><th>Payment</th><th class="r">Total</th><th class="r">Est. profit</th><th></th></tr></thead>
  <tbody>${orders.map((o) => `<tr class="${o.status === 'Awaiting Purchase' ? 'row-hot' : ''}">
    <td><a href="/admin/orders/${o.id}" class="strong">${esc(o.order_number)}</a></td>
    <td class="nowrap">${fmtDay(o.created_at)}</td>
    <td>${esc(o.customer_name)}<div class="muted small">${esc(o.email)}</div></td>
    ${compact ? '' : `<td>${o.item_count}</td>`}
    <td>${pill(o.status)}</td>
    <td><span class="pay pay-${esc(o.payment_status)}">${esc(o.payment_status)}</span></td>
    <td class="r">${money(o.total_cents)}</td>
    <td class="r ${o.fin.profit < 0 ? 'neg' : 'pos'}">${o.payment_status === 'unpaid' ? '—' : money(o.fin.profit)}</td>
    <td class="r"><a href="/admin/orders/${o.id}" class="btn btn-sm ${o.status === 'Awaiting Purchase' ? 'btn-primary' : ''}">${o.status === 'Awaiting Purchase' ? 'Fulfill' : 'Open'}</a></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function dashboard({ session, settings, stats, queue, recent, days, top, stripeReady, testMode, unread }) {
  const body = `
  <div class="page-head"><div><h1>Dashboard</h1><p class="muted">Based on paid orders. Refunded orders are excluded from revenue.</p></div>
    <div class="row">${stripeReady ? `<span class="tag ${testMode ? 'tag-warn' : 'tag-ok'}">Stripe: ${testMode ? 'TEST mode' : 'LIVE'}</span>` : '<a href="/admin/settings" class="tag tag-bad">Stripe not configured</a>'}</div></div>
  ${queue.length ? `<div class="callout"><b>${queue.length} order${queue.length === 1 ? '' : 's'} waiting for you to purchase from the supplier.</b> <a href="/admin/orders?status=Awaiting+Purchase">Open the purchase queue →</a></div>` : ''}
  <div class="kpis">
    ${kpi('Total revenue', money(stats.revenue), `${stats.orders} paid orders`)}
    ${kpi('Estimated profit', money(stats.profit), stats.revenue ? `${Math.round((stats.profit / stats.revenue) * 100)}% margin` : '', stats.profit < 0 ? 'neg' : 'pos')}
    ${kpi('Supplier expenses', money(stats.supplier), 'Product + supplier shipping')}
    ${kpi('Processing fees', money(stats.fees), 'Stripe fees')}
    ${kpi('Total sales', String(stats.units), 'Units sold')}
    ${kpi('Total orders', String(stats.orders), `Avg ${money(stats.orders ? stats.revenue / stats.orders : 0)}`)}
    ${kpi('Pending orders', String(stats.pending), 'Need purchase / in progress', stats.pending ? 'warn' : '')}
    ${kpi('Completed orders', String(stats.completed), 'Delivered')}
  </div>
  <div class="grid-2">
    <section class="panel"><div class="panel-head"><h2>Revenue · last 30 days</h2><span class="muted">${money(days.reduce((a, d) => a + d.revenue, 0))}</span></div>${revenueChart(days)}</section>
    <section class="panel"><div class="panel-head"><h2>Top products</h2></div>
      ${top.length ? `<table class="table table-sm"><thead><tr><th>Product</th><th class="r">Units</th><th class="r">Revenue</th><th class="r">Est. profit</th></tr></thead><tbody>${top.map((t) => `<tr><td>${esc(t.name)}</td><td class="r">${t.units}</td><td class="r">${money(t.revenue)}</td><td class="r ${t.profit < 0 ? 'neg' : 'pos'}">${money(t.profit)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No sales yet.</div>'}
    </section>
  </div>
  <section class="panel"><div class="panel-head"><h2>Recent orders</h2><a href="/admin/orders">All orders →</a></div>${ordersTable(recent, { compact: true })}</section>
  ${unread ? `<div class="callout callout-soft">${unread} unread customer message${unread === 1 ? '' : 's'}. <a href="/admin/messages">Read messages →</a></div>` : ''}`;
  return adminLayout({ title: 'Dashboard', session, settings, body, active: '/admin' });
}

function ordersList({ session, settings, orders, status, q, counts, flash }) {
  const tabs = ['All', ...STATUSES];
  const body = `
  <div class="page-head"><h1>Orders</h1>
    <form method="get" class="search-inline"><input type="hidden" name="status" value="${esc(status || '')}"><input type="search" name="q" value="${esc(q || '')}" placeholder="Search order #, name, email"><button class="btn">Search</button></form></div>
  <div class="tabs">${tabs.map((t) => {
    const val = t === 'All' ? '' : t; const n = t === 'All' ? counts._all : counts[t] || 0;
    return `<a href="/admin/orders${val ? '?status=' + encodeURIComponent(val) : ''}" class="${(status || '') === val ? 'active' : ''}">${esc(t)} <span>${n}</span></a>`;
  }).join('')}</div>
  <section class="panel">${ordersTable(orders)}</section>`;
  return adminLayout({ title: 'Orders', session, settings, body, active: '/admin/orders', flash });
}

function orderDetail({ session, settings, order: o, items, fin, events, flash, stripeReady }) {
  const t = session.csrf;
  const paid = o.payment_status === 'paid';
  const canPurchase = paid && ['Paid', 'Awaiting Purchase'].includes(o.status);
  const steps = [
    ['Purchase from supplier', Boolean(o.purchased_at) || ['Purchased', 'Shipped', 'Delivered'].includes(o.status)],
    ['Add tracking', Boolean(o.tracking_number)],
    ['Mark shipped', ['Shipped', 'Delivered'].includes(o.status)],
    ['Mark delivered', o.status === 'Delivered'],
  ];
  const addressText = `${o.customer_name}\n${o.address1}${o.address2 ? '\n' + o.address2 : ''}\n${o.city}, ${o.state} ${o.zip}\nUnited States${o.phone ? '\n' + o.phone : ''}`;
  const copyRow = (label, value) => `<div class="copy-row"><span class="muted">${label}</span><b>${esc(value || '—')}</b>${value ? `<button type="button" class="copy" data-copy="${esc(value)}" title="Copy">Copy</button>` : ''}</div>`;

  const body = `
  <div class="page-head">
    <div><a href="/admin/orders" class="muted small">← All orders</a><h1>${esc(o.order_number)} ${pill(o.status)}</h1>
      <p class="muted">Placed ${fmtDate(o.created_at)} · Payment: <span class="pay pay-${esc(o.payment_status)}">${esc(o.payment_status)}</span>${o.paid_at ? ` · Paid ${fmtDate(o.paid_at)}` : ''}</p></div>
  </div>
  ${o.admin_notes && o.admin_notes.includes('AMOUNT MISMATCH') ? `<div class="flash flash-error">${esc(o.admin_notes)}</div>` : ''}
  ${!paid && o.status === 'Awaiting Payment' ? '<div class="callout callout-soft">This customer has not completed payment. <b>Do not purchase anything from the supplier for this order.</b> Unpaid orders are cancelled automatically when the Stripe session expires.</div>' : ''}

  <ol class="steps">${steps.map(([l, done], i) => `<li class="${done ? 'done' : ''}"><span>${done ? '✓' : i + 1}</span>${l}</li>`).join('')}</ol>

  <div class="grid-2 align-start">
    <div class="stack">
      <section class="panel">
        <div class="panel-head"><h2>Products to purchase</h2><span class="muted">${items.reduce((a, i) => a + i.quantity, 0)} unit(s)</span></div>
        ${fin.items.map((i) => `<div class="buy-item">
          ${i.image ? `<img src="${esc(i.image)}" alt="">` : '<div class="ph"></div>'}
          <div class="bi-main">
            <b>${esc(i.name)}</b>
            ${i.options ? `<div class="bi-opts">Customer chose: <b>${esc(i.options)}</b> <button type="button" class="copy" data-copy="${esc(i.options)}">Copy</button></div>` : ''}
            <div class="bi-grid">
              <span>Quantity <b class="qty-big">${i.quantity}</b></span>
              <span>Our price <b>${money(i.unit_price_cents)}</b></span>
              <span>Supplier cost <b>${money(i.supplier_cost_cents)}</b></span>
              <span>Supplier shipping <b>${money(i.supplier_shipping_cents)}</b></span>
              <span>Est. profit / unit <b class="${i.profitPerUnit < 0 ? 'neg' : 'pos'}">${money(i.profitPerUnit)}</b></span>
              <span>Line profit <b class="${i.lineProfit < 0 ? 'neg' : 'pos'}">${money(i.lineProfit)}</b></span>
            </div>
            ${i.supplier_notes ? `<div class="note small">📝 ${esc(i.supplier_notes)}</div>` : ''}
            ${i.supplier_url ? `<div class="muted small ellipsis">Supplier: <a href="${esc(i.supplier_url)}" target="_blank" rel="noopener noreferrer">${esc(i.supplier_url)}</a></div>` : '<div class="neg small">No supplier URL saved for this product. Add it on the product page.</div>'}
          </div>
          <div class="bi-cta">
            ${i.supplier_url && paid ? `<a class="btn btn-buy" href="${esc(i.supplier_url)}" target="_blank" rel="noopener noreferrer">PURCHASE PRODUCT ↗</a>` : '<button class="btn btn-buy" disabled>PURCHASE PRODUCT</button>'}
            ${!paid ? '<small class="muted">Unlocks after the customer pays</small>' : !canPurchase && !['Purchased', 'Shipped', 'Delivered'].includes(o.status) ? '<small class="muted">Order is not awaiting purchase</small>' : ''}
          </div>
        </div>`).join('')}
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Fulfillment actions</h2></div>
        <div class="actions">
          <form method="post" action="/admin/orders/${o.id}/action" class="action-card ${canPurchase ? 'hot' : ''}">
            ${csrfField(t)}<input type="hidden" name="action" value="mark_purchased">
            <h3>1 · Mark as Purchased</h3>
            ${o.purchased_at ? `<p class="ok">✓ Marked purchased ${fmtDate(o.purchased_at)}</p>` : canPurchase ? `
              <label>Supplier order number<input name="supplier_order_number" maxlength="100" placeholder="e.g. 8123-4456-77"></label>
              <label>Actual amount paid to supplier (optional)<input name="actual_supplier_cost" inputmode="decimal" placeholder="${centsToInput(fin.estSupplier + fin.supplierShipping)}"></label>
              <label class="check"><input type="checkbox" name="confirm" value="yes" required><span>I confirm I personally placed <b>and paid for</b> this order on the supplier's website.</span></label>
              <button class="btn btn-primary">Mark as Purchased</button>` : `<p class="muted small">${paid ? 'Not available for this status.' : 'Available after the customer has paid.'}</p>`}
          </form>

          <form method="post" action="/admin/orders/${o.id}/action" class="action-card">
            ${csrfField(t)}<input type="hidden" name="action" value="save_supplier_order">
            <h3>Supplier order number</h3>
            <label>Supplier order #<input name="supplier_order_number" maxlength="100" value="${esc(o.supplier_order_number)}"></label>
            <button class="btn">Save supplier order #</button>
          </form>

          <form method="post" action="/admin/orders/${o.id}/action" class="action-card">
            ${csrfField(t)}<input type="hidden" name="action" value="save_tracking">
            <h3>2 · Add Tracking Number</h3>
            <label>Carrier<input name="tracking_carrier" list="carriers" maxlength="60" value="${esc(o.tracking_carrier)}" placeholder="USPS, UPS, FedEx, YunExpress…"></label>
            <datalist id="carriers"><option>USPS</option><option>UPS</option><option>FedEx</option><option>DHL</option><option>YunExpress</option><option>4PX</option><option>Cainiao</option></datalist>
            <label>Tracking number<input name="tracking_number" maxlength="100" value="${esc(o.tracking_number)}"></label>
            <label>Tracking URL (optional)<input name="tracking_url" maxlength="500" value="${esc(o.tracking_url)}" placeholder="Leave blank to auto-generate for common carriers"></label>
            <button class="btn">Save tracking</button>
          </form>

          <form method="post" action="/admin/orders/${o.id}/action" class="action-card">
            ${csrfField(t)}<input type="hidden" name="action" value="mark_shipped">
            <h3>3 · Mark as Shipped</h3>
            ${o.shipped_at ? `<p class="ok">✓ Shipped ${fmtDate(o.shipped_at)}</p>` : `<p class="muted small">Emails the customer their tracking info.</p>
            <label class="check"><input type="checkbox" name="notify" value="1" checked> Email the customer</label>
            <button class="btn btn-primary" ${o.status === 'Purchased' ? '' : 'disabled'}>Mark as Shipped</button>
            ${o.status !== 'Purchased' ? '<small class="muted">Requires status “Purchased”.</small>' : ''}`}
          </form>

          <form method="post" action="/admin/orders/${o.id}/action" class="action-card">
            ${csrfField(t)}<input type="hidden" name="action" value="mark_delivered">
            <h3>4 · Mark as Delivered</h3>
            ${o.delivered_at ? `<p class="ok">✓ Delivered ${fmtDate(o.delivered_at)}</p>` : `<button class="btn btn-primary" ${o.status === 'Shipped' ? '' : 'disabled'}>Mark as Delivered</button>
            ${o.status !== 'Shipped' ? '<small class="muted">Requires status “Shipped”.</small>' : ''}`}
          </form>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Timeline</h2></div>
        <ul class="timeline">${events.map((e) => `<li><span class="muted small">${fmtDate(e.created_at)} · ${esc(e.actor)}</span><p>${esc(e.message)}</p></li>`).join('')}</ul>
      </section>
    </div>

    <div class="stack">
      <section class="panel">
        <div class="panel-head"><h2>Ship to</h2><button type="button" class="btn btn-sm" data-copy="${esc(addressText)}">Copy full address</button></div>
        ${copyRow('Name', o.customer_name)}${copyRow('Address', o.address1)}${o.address2 ? copyRow('Address 2', o.address2) : ''}
        ${copyRow('City', o.city)}${copyRow('State', o.state)}${copyRow('ZIP', o.zip)}${copyRow('Country', 'United States')}
        ${copyRow('Phone', o.phone)}${copyRow('Email', o.email)}
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Profit</h2>${fin.feeIsActual ? '<span class="tag tag-ok">Actual Stripe fee</span>' : '<span class="tag">Estimated fee</span>'}</div>
        <div class="fin">
          <div><span>Customer paid</span><b>${money(fin.grossPaid)}</b></div>
          <div class="muted"><span>(Subtotal ${money(o.subtotal_cents)} + shipping ${money(o.shipping_cents)})</span></div>
          <div><span>Supplier product cost${fin.usingActualSupplier ? ' (actual, incl. shipping)' : ''}</span><b>− ${money(fin.supplierCost)}</b></div>
          ${fin.usingActualSupplier ? '' : `<div><span>Supplier shipping</span><b>− ${money(fin.supplierShipping)}</b></div>`}
          <div><span>Payment processing fee</span><b>− ${money(fin.fee)}</b></div>
          <div><span>Other expenses</span><b>− ${money(fin.other)}</b></div>
          ${o.status === 'Refunded' ? '<div class="muted"><span>Refunded: revenue counted as $0</span></div>' : ''}
          <div class="fin-total ${fin.profit < 0 ? 'neg' : 'pos'}"><span>Estimated profit</span><b>${paid || o.status === 'Refunded' ? money(fin.profit) : '—'}</b></div>
        </div>
        <form method="post" action="/admin/orders/${o.id}/action" class="inline-form">
          ${csrfField(t)}<input type="hidden" name="action" value="save_costs">
          <label>Other expenses ($)<input name="other_expenses" inputmode="decimal" value="${centsToInput(o.other_expenses_cents)}"></label>
          <label>Actual supplier total ($)<input name="actual_supplier_cost" inputmode="decimal" value="${centsToInput(o.actual_supplier_cost_cents)}" placeholder="optional"></label>
          <button class="btn btn-sm">Update</button>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Notes</h2></div>
        <form method="post" action="/admin/orders/${o.id}/action">${csrfField(t)}<input type="hidden" name="action" value="save_notes">
          <textarea name="admin_notes" rows="4" maxlength="4000" placeholder="Private notes (not visible to customer)">${esc(o.admin_notes)}</textarea>
          <button class="btn btn-sm">Save notes</button></form>
      </section>

      <section class="panel">
        <div class="panel-head"><h2>Payment</h2></div>
        <div class="copy-row"><span class="muted">Stripe session</span><b class="mono small ellipsis">${esc(o.stripe_session_id || '—')}</b></div>
        <div class="copy-row"><span class="muted">Payment intent</span><b class="mono small ellipsis">${esc(o.stripe_payment_intent || '—')}</b></div>
        ${o.stripe_payment_intent ? `<a class="btn btn-sm" target="_blank" rel="noopener" href="https://dashboard.stripe.com/${o.stripe_session_id?.startsWith('cs_test') ? 'test/' : ''}payments/${esc(o.stripe_payment_intent)}">View in Stripe ↗</a>` : ''}
      </section>

      <section class="panel danger">
        <div class="panel-head"><h2>Cancel / refund / correct</h2></div>
        ${paid && o.status !== 'Refunded' && stripeReady ? `<form method="post" action="/admin/orders/${o.id}/action" data-confirm="Refund ${money(o.amount_paid_cents ?? o.total_cents)} to the customer through Stripe? This cannot be undone.">
          ${csrfField(t)}<input type="hidden" name="action" value="refund"><button class="btn btn-danger btn-block">Refund full amount via Stripe</button></form>` : ''}
        ${['Awaiting Payment', 'Paid', 'Awaiting Purchase'].includes(o.status) ? `<form method="post" action="/admin/orders/${o.id}/action" data-confirm="Cancel this order?${paid ? ' The customer has paid — remember to refund them too.' : ''}">
          ${csrfField(t)}<input type="hidden" name="action" value="cancel"><button class="btn btn-block">Cancel order</button></form>` : ''}
        <form method="post" action="/admin/orders/${o.id}/action" class="inline-form" data-confirm="Change the status of this order manually?">
          ${csrfField(t)}<input type="hidden" name="action" value="set_status">
          <label>Manual status correction<select name="status">${STATUSES.filter((s) => !['Paid', 'Purchased', 'Awaiting Payment'].includes(s) || s === o.status).map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <button class="btn btn-sm">Set status</button>
        </form>
        <p class="muted small">“Paid” is only set by verified Stripe payments and “Purchased” only via the confirmation above.</p>
      </section>
    </div>
  </div>`;
  return adminLayout({ title: o.order_number, session, settings, body, active: '/admin/orders', flash });
}

function productsList({ session, settings, products, q, flash }) {
  const body = `
  <div class="page-head"><h1>Products</h1><div class="row">
    <form method="get" class="search-inline"><input type="search" name="q" value="${esc(q || '')}" placeholder="Search products"><button class="btn">Search</button></form>
    <a href="/admin/products/new" class="btn btn-primary">+ Add product</a></div></div>
  ${products.some((p) => !p.active) ? `<div class="callout callout-soft">${products.filter((p) => !p.active).length} draft product${products.filter((p) => !p.active).length === 1 ? '' : 's'} hidden from the store. Open each one, add its name, photos, price and supplier link, then tick <b>Active</b> to publish.</div>` : ''}
  <section class="panel">${products.length ? `<div class="table-wrap"><table class="table">
    <thead><tr><th></th><th>Product</th><th>Category</th><th class="r">Price</th><th class="r">Supplier cost</th><th class="r">Supplier ship</th><th class="r">Profit / unit</th><th>Supplier</th><th>Status</th><th></th></tr></thead>
    <tbody>${products.map((p) => {
      let img = ''; try { img = JSON.parse(p.images)[0] || ''; } catch { /* none */ }
      const profit = p.price_cents - p.supplier_cost_cents - p.supplier_shipping_cents;
      return `<tr>
      <td><a href="/admin/products/${p.id}">${img ? `<img src="${esc(img)}" class="thumb" alt="">` : '<div class="thumb thumb-empty" title="Add a photo">+</div>'}</a></td>
      <td><a href="/admin/products/${p.id}" class="strong">${esc(p.name)}</a><div class="muted small">${p.options ? `${esc(p.options.split('\n').map((l) => l.split(':')[0]).join(' / '))} options · ` : ''}${p.featured ? '★ Featured ' : ''}${p.best_seller ? '· Best seller ' : ''}${p.compare_at_cents > p.price_cents ? '· On sale' : ''}</div></td>
      <td>${esc(p.category_name || '—')}</td>
      <td class="r">${money(p.price_cents)}</td><td class="r">${money(p.supplier_cost_cents)}</td><td class="r">${money(p.supplier_shipping_cents)}</td>
      <td class="r ${profit < 0 ? 'neg' : 'pos'}">${money(profit)} <span class="muted small">${p.price_cents ? Math.round((profit / p.price_cents) * 100) : 0}%</span></td>
      <td>${p.supplier_url ? `<a href="${esc(p.supplier_url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : '<span class="neg small">Missing</span>'}</td>
      <td>${p.active ? '<span class="tag tag-ok">Live</span>' : '<span class="tag">Draft</span>'}${img ? '' : ' <span class="tag tag-warn">Needs photo</span>'}</td>
      <td class="r nowrap"><a href="/admin/products/${p.id}" class="btn btn-sm">Edit</a> <a href="/product/${esc(p.slug)}" target="_blank" class="btn btn-sm">View</a></td></tr>`;
    }).join('')}</tbody></table></div>` : '<div class="empty">No products yet. <a href="/admin/products/new">Add your first product →</a></div>'}</section>`;
  return adminLayout({ title: 'Products', session, settings, body, active: '/admin/products', flash });
}

function productForm({ session, settings, p = {}, categories, errors = {}, flash }) {
  const isNew = !p.id; const t = session.csrf;
  let images = []; try { images = JSON.parse(p.images || '[]'); } catch { /* none */ }
  const err = (k) => (errors[k] ? `<span class="err">${esc(errors[k])}</span>` : '');
  const body = `
  <div class="page-head"><div><a href="/admin/products" class="muted small">← Products</a><h1>${isNew ? 'Add product' : esc(p.name)}</h1></div>
    ${!isNew ? `<a href="/product/${esc(p.slug)}" target="_blank" class="btn">View in store ↗</a>` : ''}</div>
  <form method="post" action="${isNew ? '/admin/products/new' : `/admin/products/${p.id}`}" enctype="multipart/form-data" class="grid-2 align-start" data-product-form>
    ${csrfField(t)}
    <div class="stack">
      <section class="panel"><div class="panel-head"><h2>Product information</h2></div>
        <label>Product name ${err('name')}<input name="name" required maxlength="140" value="${esc(p.name || '')}"></label>
        <label>Short description ${err('description')}<textarea name="description" rows="4" maxlength="2000">${esc(p.description || '')}</textarea></label>
        <label>Details / features <small class="muted">(one per line, shown as bullet points)</small><textarea name="details" rows="6" maxlength="4000">${esc(p.details || '')}</textarea></label>
        <label>Options customers choose <small class="muted">(optional — one per line, e.g. <code>Size: S, M, L, XL</code> and <code>Color: Black, White</code>; up to 3)</small>${err('options')}<textarea name="options" rows="3" maxlength="2000" placeholder="Size: S, M, L, XL&#10;Color: Black, White">${esc(p.options || '')}</textarea></label>
        <label>Category<select name="category_id"><option value="">— None —</option>${categories.map((c) => `<option value="${c.id}" ${p.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
        <small class="muted"><a href="/admin/categories">Manage categories</a></small>
      </section>
      <section class="panel"><div class="panel-head"><h2>Photos</h2><span class="muted small">${images.length}/${MAX_IMAGES} · first photo is the main one</span></div>
        <div class="slots">
          ${images.map((im, i) => `<div class="slot filled">
            <img src="${esc(im)}" alt="Product photo ${i + 1}">
            ${i === 0 ? '<em>Main</em>' : ''}
            <div class="slot-tools">
              ${i === 0 ? '' : `<label class="chip"><input type="radio" name="main_image" value="${esc(im)}"> Make main</label>`}
              <label class="chip danger"><input type="checkbox" name="remove_images[]" value="${esc(im)}" data-remove-toggle> Remove</label>
            </div>
          </div>`).join('')}
          ${Array.from({ length: Math.max(0, MAX_IMAGES - images.length) }, (_, i) => `<label class="slot empty" data-slot>
            <input type="file" name="images" accept="image/jpeg,image/png,image/webp,image/gif" data-slot-input>
            <span class="slot-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>${images.length === 0 && i === 0 ? 'Add main photo' : 'Add photo'}</span>
            <img alt="" data-slot-preview hidden>
            <button type="button" class="slot-clear" data-slot-clear hidden aria-label="Clear">×</button>
          </label>`).join('')}
        </div>
        <p class="muted small">Click a slot or drag a photo onto it. JPG, PNG, WEBP or GIF, up to 5 MB each. Square photos (e.g. 1000×1000) on a dark background look best. Photos upload when you save.</p>
        ${err('images')}
      </section>
    </div>
    <div class="stack">
      <section class="panel"><div class="panel-head"><h2>Pricing</h2></div>
        <div class="form-row">
          <label>Selling price ($) ${err('price')}<input name="price" inputmode="decimal" required value="${centsToInput(p.price_cents)}" data-calc="price"></label>
          <label>Compare-at price ($) <small class="muted">shows a sale</small>${err('compare_at')}<input name="compare_at" inputmode="decimal" value="${centsToInput(p.compare_at_cents)}"></label>
        </div>
      </section>
      <section class="panel private"><div class="panel-head"><h2>Supplier (private)</h2><span class="tag">Never shown to customers</span></div>
        <label>Supplier product URL ${err('supplier_url')}<input name="supplier_url" type="url" maxlength="1000" placeholder="https://supplier.example.com/product/123" value="${esc(p.supplier_url || '')}"></label>
        <div class="form-row">
          <label>Supplier cost ($) ${err('supplier_cost')}<input name="supplier_cost" inputmode="decimal" value="${centsToInput(p.supplier_cost_cents ?? 0)}" data-calc="cost"></label>
          <label>Supplier shipping ($) ${err('supplier_shipping')}<input name="supplier_shipping" inputmode="decimal" value="${centsToInput(p.supplier_shipping_cents ?? 0)}" data-calc="ship"></label>
        </div>
        <div class="calc" data-calc-out></div>
        <label>Supplier notes <small class="muted">(variant, color, size to choose, etc.)</small><textarea name="supplier_notes" rows="3" maxlength="2000">${esc(p.supplier_notes || '')}</textarea></label>
      </section>
      <section class="panel"><div class="panel-head"><h2>Visibility</h2></div>
        <label class="check"><input type="checkbox" name="active" value="1" ${p.active === 0 ? '' : 'checked'}> <span>Active (visible in store)<br><small class="muted">Needs at least one photo before it can go live.</small></span></label>
        ${err('active')}
        <label class="check"><input type="checkbox" name="featured" value="1" ${p.featured ? 'checked' : ''}> Featured on homepage</label>
        <label class="check"><input type="checkbox" name="best_seller" value="1" ${p.best_seller ? 'checked' : ''}> Best seller</label>
      </section>
      <div class="row"><button class="btn btn-primary btn-lg">${isNew ? 'Create product' : 'Save changes'}</button><a href="/admin/products" class="btn">Cancel</a></div>
    </div>
  </form>
  ${!isNew ? `<form method="post" action="/admin/products/${p.id}/delete" class="panel danger" data-confirm="Delete “${esc(p.name)}” permanently? Past orders keep their copy of the product details.">
    ${csrfField(t)}<div class="panel-head"><h2>Delete product</h2></div><p class="muted small">Tip: uncheck “Active” to hide a product without deleting it.</p><button class="btn btn-danger">Delete product</button></form>` : ''}`;
  return adminLayout({ title: isNew ? 'Add product' : p.name, session, settings, body, active: '/admin/products', flash });
}

function categories({ session, settings, cats, flash }) {
  const t = session.csrf;
  const imgField = (c) => `<label class="cat-img ${c?.image ? 'has' : ''}" title="Category image">${c?.image ? `<img src="${esc(c.image)}" alt="">` : '<span>+ Image</span>'}<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" data-cat-img></label>`;
  const body = `
  <div class="page-head"><div><h1>Categories</h1><p class="muted">Add as many as you like. Categories with at least one live product appear in the store menu and on the homepage, in sort order.</p></div></div>
  <div class="grid-2 align-start">
    <section class="panel"><div class="panel-head"><h2>All categories (${cats.length})</h2></div>
      ${cats.length ? cats.map((c) => `<form method="post" action="/admin/categories/${c.id}" enctype="multipart/form-data" class="cat-row">${csrfField(t)}
        ${imgField(c)}
        <div class="cat-fields">
          <input name="name" value="${esc(c.name)}" required maxlength="60" aria-label="Name">
          <input name="description" value="${esc(c.description)}" maxlength="300" placeholder="Short description (optional)" aria-label="Description">
          <div class="row small muted">
            <label class="inline">Sort <input name="sort" type="number" value="${c.sort}" class="w-sm" aria-label="Sort order"></label>
            <span>${c.live} live · ${c.count} total</span>
            <a href="/category/${esc(c.slug)}" target="_blank" rel="noopener">View ↗</a>
            ${c.image ? '<label class="inline"><input type="checkbox" name="remove_image" value="1"> Remove image</label>' : ''}
          </div>
        </div>
        <div class="cat-actions">
          <button class="btn btn-sm" name="op" value="save">Save</button>
          <button class="btn btn-sm btn-danger" name="op" value="delete" data-confirm-click="Delete category “${esc(c.name)}”? Its products stay, but become uncategorized.">Delete</button>
        </div>
      </form>`).join('') : '<div class="empty">No categories yet.</div>'}
    </section>
    <form method="post" action="/admin/categories/new" enctype="multipart/form-data" class="panel">${csrfField(t)}<div class="panel-head"><h2>Add category</h2></div>
      <label>Name<input name="name" required maxlength="60" placeholder="e.g. Streetwear, Phone Accessories, Gaming"></label>
      <label>Description <small class="muted">(shown at the top of the category page)</small><input name="description" maxlength="300"></label>
      <label>Sort order <small class="muted">(lower shows first)</small><input name="sort" type="number" value="${(cats.at(-1)?.sort ?? -1) + 1}"></label>
      <label>Image <small class="muted">(optional, used for the homepage tile; otherwise the first product photo is used)</small><input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></label>
      <button class="btn btn-primary">Add category</button></form>
  </div>`;
  return adminLayout({ title: 'Categories', session, settings, body, active: '/admin/categories', flash });
}

function messages({ session, settings, msgs, flash }) {
  const t = session.csrf;
  const body = `<div class="page-head"><h1>Messages</h1></div>
  <section class="panel">${msgs.length ? msgs.map((m) => `<article class="msg ${m.is_read ? '' : 'unread'}">
    <div class="msg-head"><b>${esc(m.subject || 'Message')}</b><span class="muted small">${fmtDate(m.created_at)}</span></div>
    <div class="muted small">${esc(m.name)} · <a href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: ' + (m.subject || 'Your message'))}">${esc(m.email)}</a>${m.order_number ? ` · Order ${esc(m.order_number)}` : ''}</div>
    <p>${esc(m.body).replace(/\n/g, '<br>')}</p>
    <form method="post" action="/admin/messages/${m.id}" class="row">${csrfField(t)}
      <a class="btn btn-sm btn-primary" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: ' + (m.subject || 'Your message'))}">Reply by email</a>
      ${m.is_read ? '' : '<button class="btn btn-sm" name="op" value="read">Mark read</button>'}
      <button class="btn btn-sm btn-danger" name="op" value="delete" data-confirm-click="Delete this message?">Delete</button></form>
  </article>`).join('') : '<div class="empty">No messages yet.</div>'}</section>`;
  return adminLayout({ title: 'Messages', session, settings, body, active: '/admin/messages', flash });
}

function reviews({ session, settings, list, products, flash }) {
  const t = session.csrf;
  const body = `<div class="page-head"><div><h1>Reviews</h1><p class="muted">Only approved reviews appear in the store. Customers can review on the website once their order is marked Delivered.</p></div></div>
  <div class="grid-2 align-start">
  <section class="panel">${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Rating</th><th>Review</th><th>Product</th><th>Source</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((r) => `<tr><td class="nowrap">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</td><td><b>${esc(r.name)}</b><div>${esc(r.body)}</div><div class="muted small">${fmtDate(r.created_at)}</div></td>
    <td>${esc(r.product_name || '—')}</td>
    <td>${r.source === 'order' ? `<span class="tag tag-ok">Website order</span>${r.order_id ? `<div class="small"><a href="/admin/orders/${r.order_id}">${esc(r.order_number || '#' + r.order_id)}</a></div>` : ''}` : `<span class="tag">${esc(REVIEW_SOURCES[r.source] || 'Other')}</span>`}</td>
    <td>${r.approved ? '<span class="tag tag-ok">Published</span>' : '<span class="tag tag-warn">Pending</span>'}</td>
    <td class="r nowrap"><form method="post" action="/admin/reviews/${r.id}">${csrfField(t)}${r.approved ? '<button class="btn btn-sm" name="op" value="unpublish">Unpublish</button>' : '<button class="btn btn-sm btn-primary" name="op" value="approve">Publish</button>'}
      <button class="btn btn-sm btn-danger" name="op" value="delete" data-confirm-click="Delete this review?">Delete</button></form></td></tr>`).join('')}
  </tbody></table></div>` : '<div class="empty">No reviews yet.</div>'}</section>

  <form method="post" action="/admin/reviews/new" class="panel">${csrfField(t)}
    <div class="panel-head"><h2>Add a review a customer sent you</h2></div>
    <p class="muted small">For genuine feedback you received outside the website, such as an in-person sale, a DM or a text. Copy what the customer actually said, and get their OK to post it.</p>
    <label>Customer display name <small class="muted">(e.g. “Marcus T.”)</small><input name="name" maxlength="60" required></label>
    <div class="form-row">
      <label>Rating<select name="rating">${[5, 4, 3, 2, 1].map((n) => `<option value="${n}">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</option>`).join('')}</select></label>
      <label>Where you got it<select name="source" required>${Object.entries(REVIEW_SOURCES).filter(([k]) => k !== 'order').map(([k, l]) => `<option value="${k}">${esc(l.replace(/^Via /, ''))}</option>`).join('')}</select></label>
    </div>
    <label>Product<select name="product_id"><option value="">— General store review —</option>${products.map((p) => `<option value="${p.id}">${esc(p.name)}${p.active ? '' : ' (draft)'}</option>`).join('')}</select></label>
    <label>Their review<textarea name="body" rows="4" maxlength="1000" required></textarea></label>
    <label class="check"><input type="checkbox" name="attest" value="yes" required><span>This is a real review from a real customer, in their own words, and they're OK with us posting it.</span></label>
    <label class="check"><input type="checkbox" name="publish" value="1" checked><span>Publish now</span></label>
    <button class="btn btn-primary">Add review</button>
    <p class="muted small">In the store these are labeled with where they came from (e.g. “Via Instagram”), separate from “Verified buyer” reviews left after a website order.</p>
  </form>
  </div>`;
  return adminLayout({ title: 'Reviews', session, settings, body, active: '/admin/reviews', flash });
}

function settingsPage({ session, settings: s, flash, status }) {
  const t = session.csrf;
  const f = (k, label, help = '', type = 'text') => `<label>${label}${help ? ` <small class="muted">${help}</small>` : ''}<input type="${type}" name="${k}" value="${esc(s[k] ?? '')}"></label>`;
  const c = (k, label, help = '') => `<label>${label}${help ? ` <small class="muted">${help}</small>` : ''}<input name="${k}" inputmode="decimal" value="${centsToInput(Number(s[k] || 0))}"></label>`;
  const row = (label, ok, hint) => `<div class="copy-row"><span>${label}</span>${ok ? '<span class="tag tag-ok">Connected</span>' : `<span class="tag tag-bad">Not set</span>`}<small class="muted">${hint}</small></div>`;
  const body = `<div class="page-head"><h1>Settings</h1></div>
  <div class="grid-2 align-start">
    <form method="post" action="/admin/settings" class="panel">${csrfField(t)}
      <div class="panel-head"><h2>Store</h2></div>
      ${f('store_name', 'Store name')}${f('tagline', 'Tagline')}${f('support_email', 'Support email', '', 'email')}${f('announcement', 'Announcement bar', 'leave blank to hide')}
      <label>Business address <small class="muted">(shown on contact & terms pages)</small><textarea name="business_address" rows="2">${esc(s.business_address)}</textarea></label>
      <div class="panel-head"><h2>Shipping (charged to customers)</h2></div>
      <div class="form-row">${c('shipping_flat_cents', 'Flat shipping ($)')}${c('free_shipping_threshold_cents', 'Free shipping over ($)', '0 = never free')}</div>
      <div class="form-row">${f('processing_time', 'Processing time')}${f('delivery_time', 'Delivery time')}</div>
      <div class="panel-head"><h2>Profit calculator</h2></div>
      <div class="form-row">${f('fee_percent', 'Processing fee (%)', 'Stripe US: 2.9')}${c('fee_fixed_cents', 'Fixed fee per order ($)', 'Stripe US: 0.30')}</div>
      <p class="muted small">Used as an estimate until the actual Stripe fee is fetched for each order.</p>
      <button class="btn btn-primary">Save settings</button>
    </form>
    <section class="panel"><div class="panel-head"><h2>Integrations</h2></div>
      ${row('Stripe secret key', status.stripe, status.stripeMode)}
      ${row('Stripe webhook secret', status.webhook, 'Needed to confirm payments automatically')}
      ${row('Email (Resend)', status.email, status.email ? '' : 'Emails are saved to data/outbox until set')}
      ${row('Public site URL', status.baseUrlOk, esc(status.baseUrl))}
      <p class="muted small">Keys live in the <code>.env</code> file on the server and are never sent to the browser. See README.md for setup steps.</p>
    </section>
  </div>`;
  return adminLayout({ title: 'Settings', session, settings: s, body, active: '/admin/settings', flash });
}

function account({ session, settings, flash, admins }) {
  const t = session.csrf;
  const body = `<div class="page-head"><h1>Account</h1></div>
  <div class="grid-2 align-start">
    <form method="post" action="/admin/account" class="panel">${csrfField(t)}<div class="panel-head"><h2>Change password</h2></div>
      <label>Current password<input type="password" name="current" autocomplete="current-password" required></label>
      <label>New password <small class="muted">(at least 10 characters)</small><input type="password" name="next" autocomplete="new-password" minlength="10" required></label>
      <label>Confirm new password<input type="password" name="confirm" autocomplete="new-password" minlength="10" required></label>
      <button class="btn btn-primary">Update password</button></form>
    <section class="panel"><div class="panel-head"><h2>Owner accounts</h2></div>
      ${admins.map((a) => `<div class="copy-row"><b>${esc(a.name)}</b><span class="muted">${esc(a.email)}</span><small class="muted">Last login ${fmtDate(a.last_login_at)}</small></div>`).join('')}
      <p class="muted small">Owner accounts are created from the server command line (<code>npm run create-admin</code>) so nobody can sign up from the website.</p></section>
  </div>`;
  return adminLayout({ title: 'Account', session, settings, body, flash });
}

module.exports = { adminLayout, login, dashboard, ordersList, orderDetail, productsList, productForm, categories, messages, reviews, settingsPage, account, pill };
