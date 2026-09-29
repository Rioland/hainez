# Decisions log

Decisions made after the original proposal (`PROPOSAL.md`). Newest first.

## Stage 3 (2026-09-29)

### Payment: pay on delivery only, for now
- Checkout offers **pay on delivery** until Stage 7 connects each store's own Paystack account. `orders.payment_method` already allows `bank_transfer` and `online`.
- The dashboard order page shows the payment method.

### Stock is reserved at checkout for storefront orders
- **What changed from Stage 2.** Stage 2 took stock when an order became paid or shipped. With pay on delivery there's no payment step, so waiting would let many pending orders promise the same last item.
- **Now:** placing an order locks the variant rows and takes the stock in the same transaction (`inventory_committed = true`). If two shoppers race for the last unit, one order goes through and the other gets "stock just changed".
- Cancelling returns the stock (unchanged Stage 2 logic). The dashboard hints now follow `inventory_committed`, not the status.

### Carts
- **Server-side carts** (`carts`, `cart_items`). The cookie `ms_cart` holds a random token; only its SHA-256 hash is stored.
- A cart line is checked live on every view: price, availability, stock. Changed lines are flagged and block checkout until fixed.
- After checkout the cart is marked converted. **Its cookie is not deleted:** changing a cookie inside a server action makes Next re-render the page, and the checkout page would bounce the now-empty cart to `/cart` before the shopper reached the confirmation. A converted cart reads as empty, and the next "add to cart" replaces the cookie.

### Customer accounts
- **Our own small module, not Better Auth.** Customer accounts are per store (same email on two stores = two accounts) and must never mix with platform (owner/staff) sessions. Passwords use Better Auth's scrypt helpers. Sessions live in `customer_sessions` (token hash only), 30 days, cookie `ms_customer`.
- **Login is timing-safe:** an unknown email still verifies against a dummy hash.
- **Which orders an account sees.** Anyone can register with any email until verification exists (Stage 10). So an account sees only orders **placed while signed in** (`orders.placed_signed_in`). Earlier guest orders with that email show up once the email is verified. Registering over a guest record keeps the name and phone the store already has.
- **Guests** reach their order through a private link: `/order/{id}?t=…`, where `t` is an HMAC of the order id (no extra storage). The page sends `Referrer-Policy: same-origin` so the token doesn't leak to other sites.

### Cookies
- Storefront cookies are httpOnly, `SameSite=Lax`, `Secure` when `USE_HTTPS=true`, and host-only. In path mode several stores share one host, so cookies also get `Path=/store/{name}`.

### Navigation after actions that change cookies
- Sign-in, sign-out and checkout finish with a **full page load** (`window.location.assign`), started inside the action callback. The whole storefront (header, cart count) depends on those cookies, and the page re-renders mid-action and may unmount the form before an effect could run.
- For the same reason, the account and sign-in pages show a prompt instead of calling `redirect()`.

### Forms keep what you typed
- React 19 resets a `<form action>` after every submission, which wiped fields when the server returned a validation error (this affected the Stage 2 dashboard forms too).
- **Rule:** spread `keepValues` from `src/components/form.tsx` on action forms; use `clearForm()` to reset on purpose (e.g. after "Add").

### Caching: `unstable_cache`, not Cache Components
- Catalog reads use `unstable_cache` with the `store:{id}`, `store:{id}:catalog` and `store:{id}:settings` tags, revalidating hourly as a safety net. Dashboard actions already expire those tags.
- Turning on Cache Components (`use cache`) would change how every existing page renders. We can migrate once the storefront settles.

### Rate limits are in memory
- Fixed window, per store and IP. Fine for one VPS process; on Vercel each instance counts separately, so it only slows abuse down. Stage 10 moves the counters to Redis/Upstash without changing callers.
- The client IP comes from the first `X-Forwarded-For` entry. Vercel sets that header itself, and Caddy ignores client-sent values unless the request comes from a trusted proxy.

### One query at a time per transaction
- A transaction is one Postgres connection, so `Promise.all` over queries didn't run them in parallel; pg just queued them, which pg 9 will turn into an error.
- **Rule:** use `inSequence()` from `src/server/db/sql.ts` (Stage 2 code updated too).

### Deferred
- **Order confirmation emails** to the shopper and the store: Stage 10 (email).
- **Theme, logo and brand colours** on the storefront: Stage 4.
- **Online payment** (store's own Paystack): Stage 7.
- **Abandoned-cart cleanup** job: with the background worker (pg-boss).

## Stage 2 (2026-09-29)

### Catalog model
- **Every product has at least one variant**, so price, SKU and stock always live on variants.
  - A product without options has one "Default" variant.
  - Options (at most 3, e.g. Size and Colour) generate the variant matrix in the editor. Unwanted combinations can be unticked.
- **Deleting a product or variant is a soft delete** (`deleted_at`), because past orders keep pointing at it. Unique slugs and SKUs only apply to live rows, so a deleted product frees its slug and SKUs.
- **Changing a product's title keeps its URL** so existing links don't break. The URL only changes if you edit the handle.
- **Descriptions are plain text** (line breaks kept). Rich text can come later.

### Money and prices
- Amounts are stored in minor units (kobo). Inputs accept `15,000.50` or `₦15000`.
- **Changing the store currency does not convert prices.** The settings page warns about this.
- **Order totals come from the database, never from the client.** `createOrder()` is the function Stage 3 checkout will call.

### Orders and stock
- `pending → paid | shipped | cancelled`, `paid → shipped | cancelled`, `shipped → delivered`.
- **Pay-on-delivery:** `pending → shipped` is allowed, and delivering an unpaid order marks it paid.
- **When stock moves:** it is taken when an order first becomes paid or shipped, and returned on cancel. (Stage 3: storefront orders reserve it at checkout instead.)
- **Concurrency:** the order row is locked (`FOR UPDATE`), so two people clicking at once can't both apply a change or double-take stock. Overselling is refused with the item and the remaining quantity named.
- **Refunds and returns** are not in scope yet. They arrive with payments in Stage 7.
- **Orders are not created manually in the admin.** Stage 2 has no "create order" screen; orders arrive from checkout in Stage 3. The demo seed makes sample orders through `createOrder()`.

### Composite foreign keys that clear only their own column
Some child columns are nullable and should only be cleared when the parent is deleted (e.g. `orders.shipping_method_id`, `categories.parent_id`). These use Postgres 15+ `ON DELETE SET NULL (column)` in `drizzle/0004_nullable_tenant_fks.sql`, because Drizzle can't express the column list. **Neon and local Postgres 18 both support it.**

### Audit log
Product, category, order, settings and delivery changes write to `audit_logs` in the same transaction as the change. A trigger makes the table append-only for every role; it only allows the FK to clear a reference when a store or user is hard-deleted. Secrets are redacted.

### Storage
- `StorageAdapter` has two implementations:
  - **S3-compatible** (R2) via `aws4fetch`, with signed PUT URLs.
  - **Local disk** (`.data/uploads`) for development.
- Local storage is refused on Vercel, because its disk is ephemeral.
- **Uploads are verified before they're recorded:** file signature (magic bytes), size cap (5 MB default), and that the key belongs to this store.

### Two pitfalls we hit (and the rules that follow)
1. **Drizzle unqualified columns in subqueries.**
   - In a single-table query, Drizzle drops table names from columns written directly in a select-field `sql` template.
   - Inside a correlated subquery this silently changed meaning: `"order_id" = "id"` bound to the inner table, so item counts came out as 0.
   - **Rule:** wrap correlated subqueries with `subquery()` from `src/server/db/sql.ts`. Integration tests now assert those aggregates.
2. **Server actions don't call `redirect()`.**
   - Next's single-roundtrip action redirect re-fetched the target page without the session cookie, which bounced the user to login.
   - **Rule:** actions return `redirectTo`, and the client navigates with `useActionRedirect`.
   - Because of this, the product editor keeps its action state outside the keyed (remounting) editor.

### Deferred
- **Plan limits** (max products, staff seats) need the plans table: Stage 6.
- **Staff invitations** need email: Stage 5/10.
- **Storefront pages and caching:** Stage 3. Dashboard changes already expire the `store:{id}:catalog` / `:settings` cache tags the storefront will use.

## Stage 1 (2026-09-29)

### Hosting: Vercel + Neon for now; VPS later
- **What changed.** Without a domain yet, the app runs on Vercel at `*.vercel.app`. The Hostinger VPS + Caddy plan is deferred, not dropped.
- **Consequence 1: path mode.** `*.vercel.app` can't have per-store subdomains, so there is a **path routing mode** (`ROUTING_MODE=path`): `/store/{name}` and `/admin`. Switching to subdomains later is an env change: `ROUTING_MODE=subdomain`, `ROOT_DOMAIN=yourbrand.com`.
- **Consequence 2: wildcard DNS.** On Vercel, `*.yourbrand.com` needs **Vercel nameservers** for the wildcard certificate.
- **Consequence 3: custom domains (Stage 8).** On Vercel these are added through the Vercel Domains API, and Vercel issues SSL. So Stage 8 gets a `HostingProvider` interface: `VercelDomains` now, Caddy on-demand TLS when on the VPS.
  - Hobby allows 50 custom domains per project. Domain additions are limited to 100 per hour per team.
- **Consequence 4: no long-running worker.** Background jobs (reminders, DNS checks, billing sweeps) will be cron-triggered routes.
  - Vercel Hobby only allows **daily** cron. Pro allows per-minute.
  - Options: Pro, an external scheduler (e.g. Upstash QStash or GitHub Actions) hitting a signed endpoint, or the VPS worker later.
- **Consequence 5: plan.** Vercel Hobby is **non-commercial only**. Pro is required before stores take real payments.

### Database roles: one connection + `SET LOCAL ROLE`
- **Proposal:** two login roles (`app_tenant`, and `app_platform` with BYPASSRLS).
- **Now:** the app connects with **one** URL (the database owner, e.g. Neon's default role). `withTenant()` switches to the `app_tenant` role per transaction.
- **Why:** it works on Neon/Supabase without superuser rights, and needs a single `DATABASE_URL`.
- **Owner-level access:** tables don't use `FORCE ROW LEVEL SECURITY`, so the owner connection sees every store. That connection is the "platform" connection, allowlisted by ESLint.
- **Pooling:** transaction-local settings are safe with pgbouncer/Neon pooling.

### IDs: portable UUID v7
`uuid_generate_v7()` is a SQL function in the bootstrap migration. It works on Postgres 14+; PG 18's built-in `uuidv7()` isn't required.

### Auth: Better Auth 1.7
- Email + password for platform users.
- Sessions are **host-only cookies**: `app.` and `admin.` sign in separately, and store hosts never receive platform cookies.
- `platformRole` can't be set from sign-up. This is tested over HTTP.
- Platform auth endpoints are 404 on store hosts.
- Rate limits are in-memory for now (5 sign-ins per minute per IP). They move to Redis/Upstash in Stage 10.
- Email verification switches on once transactional email exists (Stage 10).

### Tables in Stage 1
- Created in Stage 1: `users`, the auth tables, `reserved_subdomains`, `platform_settings`, `stores`, `store_members`, `domains`.
- Every other table from `schema-proposal.sql` arrives in the stage that uses it.
- `stores.billing_status` is only changed by platform code. The trial → grace → suspended sweeper is Stage 6.

### Deferred
- **Redis:** until rate limiting needs it (Stage 10).
- **pg-boss:** until the VPS.
- **Theme fonts (Stage 4):** `next/font` needs fonts at build time. Local builds here can't reach Google Fonts, so the platform uses the self-hosted `geist` package. The storefront font list will use self-hosted packages as well.
