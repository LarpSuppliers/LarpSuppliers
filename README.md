# Dropshipping Store: Setup Guide

This is a complete online store with:

- a **storefront** for any kind of product (clothing, electronics, trending items and more): homepage, a Shop menu listing every category, search/filter/sort, product pages with size/color options, cart, checkout, order tracking, contact and policy pages
- **Stripe Checkout** for payments, confirmed on the server with signed webhooks
- a **private owner dashboard** for products, orders, analytics and a **manual supplier purchasing** workflow

It has **no third-party dependencies**. It runs on plain Node.js using its built-in web server and built-in SQLite database. There is no `npm install` step and no packages to keep patched.

> **Nothing is ever bought from a supplier automatically.** The dashboard only opens the supplier's page in a new tab. An order is only marked "Purchased" after one of you ticks a confirmation box saying you paid the supplier yourself.

---

## 1. Run it on your computer (10 minutes)

**You need:** Node.js **22.13 or newer**. Download the LTS version from https://nodejs.org. Check your version with `node -v`.

```bash
cd dropship-store
cp .env.example .env          # Windows: copy .env.example .env
npm run seed                  # adds 6 starter categories + 12 empty product slots (hidden drafts)
npm run create-admin          # run this twice, once for each owner
npm start
```

- Store: http://localhost:3000
- Owner dashboard: http://localhost:3000/admin

The store works without Stripe, but checkout stays disabled until you connect it (step 2).

## 2. Connect Stripe (test mode first)

1. Create a free account at https://dashboard.stripe.com/register.
2. Make sure **Test mode** is switched on (top right of the Stripe dashboard).
3. Go to **Developers → API keys** and copy the **Secret key** (`sk_test_...`).
4. Put it in `.env`:
   ```
   STRIPE_SECRET_KEY=sk_test_xxxxxxxx
   ```
5. **Webhook (this is what confirms payments).**
   - **On your computer:** install the Stripe CLI (https://docs.stripe.com/stripe-cli), then run:
     ```bash
     stripe login
     stripe listen --forward-to localhost:3000/webhooks/stripe
     ```
     It prints a `whsec_...` secret. Put it in `.env` as `STRIPE_WEBHOOK_SECRET`, then restart `npm start`. Keep `stripe listen` running while you test.
   - **On your live site:** in Stripe go to **Developers → Webhooks → Add endpoint**:
     - URL: `https://YOUR-DOMAIN/webhooks/stripe`
     - Events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`
     - Copy that endpoint's **Signing secret** into `STRIPE_WEBHOOK_SECRET` on your server.
6. Place a test order. Use card `4242 4242 4242 4242`, any future expiry date and any CVC. The order should show up in **/admin → Orders** as **Awaiting Purchase**.

**How payment is verified:** prices are always recalculated from the database (whatever the browser sends is ignored). An order only becomes "paid" when Stripe sends a **signed** webhook, or when the server fetches the session directly from Stripe's API. The amount Stripe charged has to match the order total exactly. Duplicate webhooks are ignored. Card numbers never touch your server.

## 3. Order emails (optional but recommended)

Without an email provider, emails are saved as files in `data/outbox/` so you can preview them.

To actually send them:

1. Create an account at https://resend.com (the free tier is enough to start).
2. Verify your store's domain under **Domains**.
3. Create an API key and add these to `.env`:
   ```
   RESEND_API_KEY=re_xxxxxxxx
   EMAIL_FROM=Your Store <orders@yourdomain.com>
   ADMIN_NOTIFY_EMAIL=you@gmail.com,partner@gmail.com
   ```

The app sends these emails:

- **To the customer:** an order confirmation after payment, and a shipping notice with tracking when you click "Mark as Shipped"
- **To you both:** a "new order" alert

## 4. Products, options and categories

- **Categories:** there's no limit. Add, rename, reorder (sort number), give an image, or delete them in **Categories**. Deleting a category never deletes its products; they just become uncategorized.
- **Options (sizes, colors, etc.):** in a product's **Options customers choose** box, write one option per line, for example:
  ```
  Size: S, M, L, XL
  Color: Black, White
  ```
  Customers must pick every option before adding to cart. Each combination is its own cart line. The choice shows in the cart, at checkout, in Stripe, in emails, and in big letters on the order page ("Customer chose: Size: L · Color: Black") so you order the right variant from the supplier.
- **Homepage sections:** tick **Featured** or **Best seller** on a product. Set a **Compare-at price** to put it in **Special deals**. **New arrivals** shows the newest live products automatically.

## 5. Your daily workflow

1. You get a new-order email, or you open **/admin**. Orders waiting on you show as **Awaiting Purchase** with a blinking orange status.
2. Open the order. For each product you'll see the quantity, the size/color the customer chose, your price, the supplier cost, the estimated profit and your supplier notes.
3. Click **PURCHASE PRODUCT**. The supplier's page opens in a new tab.
4. Use the **Copy** buttons to paste the customer's name and address into the supplier's checkout. Pay the supplier yourself.
5. Back in the dashboard, enter the supplier order number (and optionally what you actually paid), tick the confirmation box, then click **Mark as Purchased**.
6. When the supplier gives you tracking, click **Add Tracking Number** (a tracking link is generated for USPS, UPS, FedEx and DHL automatically), then **Mark as Shipped**. That emails the customer.
7. Once it arrives, click **Mark as Delivered**. The customer can now leave a review from the order tracking page. Reviews only appear in the store after you publish them in **Reviews**.

**Reviews from outside the website:** in **Reviews → Add a review a customer sent you** you can enter genuine feedback from an in-person sale, Instagram, TikTok, a text or an email. You have to confirm it's a real customer's own words. In the store it's labeled with where it came from (e.g. "Via Instagram"), while reviews from website orders show "Verified buyer". Reviews appear on the homepage and on that product's page with an average star rating.

**Refunds:** use **Refund full amount via Stripe** on the order page. If you refund inside the Stripe dashboard instead, the webhook updates the order automatically.

**Profit math:** customer payment − supplier product cost − supplier shipping − payment processing fee − other expenses.

- The processing fee is estimated from **Settings** (2.9% + $0.30 by default). It's replaced by the **actual** Stripe fee once Stripe reports it.
- If you enter the actual amount you paid the supplier, that number replaces both supplier lines.

## 6. Put it online

You need a host that can run Node.js and has a **persistent disk** (for the database and uploaded photos). **Render** is the easiest:

1. Put this folder in a **private** GitHub repository. `.env` and `data/` are git-ignored on purpose.
2. On https://render.com create a **Web Service** from that repo:
   - Runtime: Node
   - Build command: *(leave empty)*
   - Start command: `npm start`
   - Add a **Disk** (1 GB is plenty) mounted at `/var/data`
3. Add these environment variables in Render, plus the Stripe and Resend keys from steps 2–3:
   ```
   NODE_ENV=production
   TRUST_PROXY=1
   DATA_DIR=/var/data
   BASE_URL=https://your-domain.com
   ```
4. In Render's **Shell** tab, run `npm run seed` (optional) and `npm run create-admin` for each owner.
5. Connect your custom domain in Render, then create the live Stripe webhook (step 2.5).

Railway, Fly.io or any small VPS also work, as long as `DATA_DIR` points at storage that survives restarts.

**Backups:** download `DATA_DIR/store.db` and the `uploads` folder regularly. Render disks support snapshots.

## 7. Before you take real money: checklist

- [ ] Set up your categories in **Categories**. Add as many as you want, give each an optional image, and use the sort number to set the order. A category only shows in the store once it has a live product.
- [ ] Fill in the product slots in **Products**: name, photos (click or drag into the photo slots, up to 8 each), price, scent notes, and the **real supplier URL and cost**, then tick **Active**. A product can't go live without at least one photo. Delete any slots you don't need.
- [ ] Use photos of the bottles you actually ship, ones you took or have rights to use. Don't use brand photos or images of designer bottles for products that aren't that brand.
- [ ] In **Settings**, set your store name, support email, shipping prices and honest processing/delivery times.
- [ ] Read the policy pages (`views/policies.js`) and adjust them to your business. Have them reviewed. They're plain-language templates, not legal advice.
- [ ] Complete Stripe account activation, then swap `sk_test_` for `sk_live_` and create the **live** webhook.
- [ ] Place one real order on a cheap item and refund it, to confirm the whole loop works.
- [ ] Both owners should log in and change their passwords under **Account**.

## 8. Managing owner accounts

```bash
npm run create-admin                          # create an owner, or reset a password (re-run with the same email)
npm run remove-admin -- someone@example.com   # remove an owner
```

There's no sign-up page, so nobody can create an account from the website.

## 9. Security notes

- Passwords are hashed with scrypt.
- Owner sessions use HttpOnly, SameSite=Strict cookies, and every dashboard form is CSRF-protected.
- Login is rate-limited.
- Supplier links, costs and notes are only ever queried by admin pages. The public queries only select customer-facing columns.
- Uploaded images are checked byte by byte (JPG/PNG/WEBP/GIF only, 5 MB max) and given random filenames.
- A strict Content-Security-Policy is applied, with no third-party scripts.
- API keys live only in `.env` / server environment variables.
- Customers can look up an order only with **both** the order number and the email address. The full street address is never shown there.

## 10. Project layout

```
server.js            HTTP server, security headers, routing
routes/store.js      storefront, cart/checkout API, Stripe webhook
routes/admin.js      owner dashboard
lib/                 database, auth, Stripe client, email, order + profit logic
views/               HTML templates (store, admin, policies)
public/              CSS, JS, icons
scripts/             seed data, create/remove owner accounts
test/e2e.test.js     end-to-end test (npm test)
```

Run `npm test` to exercise the whole flow against a mock Stripe: checkout, signed webhooks, the manual purchase flow, refunds, uploads and reviews.
