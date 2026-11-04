'use strict';
// Policy page templates. These are starting points written in plain language —
// have them reviewed for your business and state before going live.
const { esc, money } = require('../lib/util');

const updated = () => new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

module.exports = {
  about: (s) => ({
    title: 'About us',
    html: `
<p class="lead">${esc(s.store_name)} is an independent online store run by two founders. We hunt down products worth buying, from clothing and electronics to whatever's trending right now, and bring them together in one place.</p>
<h2>What we sell</h2>
<p>Our catalog covers a bit of everything: everyday clothing, useful tech and accessories, viral finds and the odd thing you didn't know you needed. We add new drops regularly and only list products we'd buy ourselves.</p>
<h2>How fulfillment works</h2>
<p>To keep prices low, we work with trusted suppliers and warehouses that ship directly to you. When you place an order, we personally review it, place it with the right supplier, and email you a tracking number as soon as it ships. That's why delivery takes ${esc(s.delivery_time)} rather than a day or two. We'd rather tell you upfront than surprise you later.</p>
<h2>Our promise</h2>
<ul>
  <li>Clear, honest delivery times on every product page.</li>
  <li>A tracking number for every order.</li>
  <li>Real people answering your emails at <a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a>.</li>
  <li>A simple <a href="/returns">30-day return policy</a> if something isn't right.</li>
</ul>`,
  }),

  shipping: (s) => ({
    title: 'Shipping policy',
    html: `
<p class="muted">Last updated ${updated()}</p>
<h2>Where we ship</h2>
<p>We currently ship to addresses within the United States, including APO/FPO addresses where the carrier allows.</p>
<h2>Processing time</h2>
<p>Orders are processed within <b>${esc(s.processing_time)}</b> (excluding weekends and holidays). Processing means we've reviewed your order and placed it with our fulfillment partner.</p>
<h2>Delivery time</h2>
<p>Once dispatched, orders typically arrive within <b>${esc(s.delivery_time)}</b>. Many of our products ship from partner warehouses, which is why delivery takes longer than big-box retailers. Items in one order may arrive in separate packages.</p>
<h2>Shipping cost</h2>
<p>Standard shipping is ${money(s.shipping_flat_cents)} per order${Number(s.free_shipping_threshold_cents) > 0 ? `, and <b>free on orders of ${money(s.free_shipping_threshold_cents)} or more</b>` : ''}. The exact amount is shown in your cart before you pay.</p>
<h2>Tracking</h2>
<p>You'll receive an email with your tracking number as soon as your order ships. You can also check status anytime on our <a href="/track">order tracking page</a>. Tracking can take 24–48 hours to show its first update.</p>
<h2>Delays, lost or damaged packages</h2>
<p>If your order hasn't arrived within the delivery window above, or arrives damaged, contact us at <a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a> with your order number and we'll send a replacement or a refund.</p>
<h2>Address accuracy</h2>
<p>Please double-check your shipping address at checkout. If you spot a mistake, email us right away — we can usually fix it if the order hasn't been placed with our supplier yet.</p>`,
  }),

  returns: (s) => ({
    title: 'Return & refund policy',
    html: `
<p class="muted">Last updated ${updated()}</p>
<h2>30-day returns</h2>
<p>If you're not happy with your purchase, contact us within <b>30 days of delivery</b> to request a return. Items should be unused and in their original packaging.</p>
<h2>How to start a return</h2>
<ol>
  <li>Email <a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a> or use our <a href="/contact">contact form</a> with your order number and the reason for the return.</li>
  <li>We'll reply with return instructions and the return address. Please don't send items back without contacting us first — returns sent to the wrong address can't be processed.</li>
  <li>Once the return is received and inspected, we'll issue your refund.</li>
</ol>
<h2>Damaged, defective or wrong items</h2>
<p>If your item arrives damaged, defective or isn't what you ordered, email us a photo within 7 days of delivery. We'll send a replacement or a full refund at no cost to you, and in most cases you won't need to return the item.</p>
<h2>Refunds</h2>
<p>Approved refunds go back to your original payment method. Depending on your bank, it can take 5–10 business days for the refund to appear. Original shipping charges are refundable only if the return is due to our error.</p>
<h2>Cancellations</h2>
<p>You can cancel your order for a full refund as long as it hasn't shipped yet. Contact us as soon as possible.</p>
<h2>Return shipping</h2>
<p>For change-of-mind returns, the customer is responsible for return shipping costs. We recommend using a trackable shipping service.</p>`,
  }),

  privacy: (s) => ({
    title: 'Privacy policy',
    html: `
<p class="muted">Last updated ${updated()}</p>
<p>This policy explains what information ${esc(s.store_name)} ("we") collects and how we use it.</p>
<h2>Information we collect</h2>
<ul>
  <li><b>Order information:</b> your name, email, phone number (optional), and shipping address.</li>
  <li><b>Payment information:</b> payments are processed by Stripe. Your card details go directly to Stripe and are <b>never</b> seen or stored by us.</li>
  <li><b>Messages:</b> anything you send us through the contact form or email.</li>
  <li><b>Basic technical data:</b> your browser stores your cart locally on your device. We don't use advertising trackers.</li>
</ul>
<h2>How we use it</h2>
<ul>
  <li>To process, fulfill and ship your order — including sharing your name and shipping address with the supplier or warehouse that ships your item.</li>
  <li>To send order confirmations, shipping updates and replies to your questions.</li>
  <li>To prevent fraud and comply with legal obligations.</li>
</ul>
<p>We do not sell your personal information.</p>
<h2>Who we share it with</h2>
<p>Stripe (payments), our fulfillment suppliers and shipping carriers (delivery), and our email provider (order emails). Each receives only what they need to do their job.</p>
<h2>Data retention</h2>
<p>We keep order records for as long as needed for accounting, tax and legal purposes.</p>
<h2>Your rights</h2>
<p>You can ask us to access, correct, or delete your personal information by emailing <a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a>. Depending on where you live (for example, California), you may have additional rights under local law.</p>
<h2>Contact</h2>
<p>Questions about privacy? Email <a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a>.</p>`,
  }),

  terms: (s) => ({
    title: 'Terms & conditions',
    html: `
<p class="muted">Last updated ${updated()}</p>
<p>By using this website and placing an order, you agree to these terms.</p>
<h2>Orders</h2>
<p>All orders are subject to availability and acceptance. We may cancel an order (with a full refund) if an item becomes unavailable, if there's a pricing error, or if we suspect fraud.</p>
<h2>Pricing and payment</h2>
<p>Prices are listed in US dollars. The total, including shipping, is shown before you pay. Payment is processed securely by Stripe at the time of purchase.</p>
<h2>Fulfillment</h2>
<p>Products are shipped by us or by our third-party suppliers and warehouses. Delivery estimates are shown in our <a href="/shipping">shipping policy</a> and are estimates, not guarantees.</p>
<h2>Returns</h2>
<p>Returns and refunds are handled under our <a href="/returns">return & refund policy</a>.</p>
<h2>Product information</h2>
<p>We try to describe and photograph products accurately. Colors and details may vary slightly from images.</p>
<h2>Limitation of liability</h2>
<p>To the extent permitted by law, our liability for any claim related to a product is limited to the amount you paid for that product.</p>
<h2>Changes</h2>
<p>We may update these terms from time to time. The version posted at the time of your order applies to that order.</p>
<h2>Contact</h2>
<p>${esc(s.store_name)} · <a href="mailto:${esc(s.support_email)}">${esc(s.support_email)}</a>${s.business_address ? ` · ${esc(s.business_address)}` : ''}</p>`,
  }),
};
