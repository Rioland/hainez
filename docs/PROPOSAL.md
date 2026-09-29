# Multi-tenant store builder: architecture proposal (pre-Stage 1)

Status: **awaiting approval**. Nothing is built yet.
Companion file: `schema-proposal.sql` has the full DDL, including RLS policies and roles. It loads cleanly into Postgres, and the tenant-isolation checks in §2.3 were run against it.

`ourplatform.com` is used as a placeholder for the real platform domain throughout.

---

## 0. Key decisions I'm proposing

| Area | Proposal | Why |
|---|---|---|
| Next.js | **Next.js 16**, App Router, TS, `proxy.ts` for host routing | In Next 16, `middleware.ts` is deprecated and renamed `proxy.ts`. It runs on the **Node.js runtime**, so it can use the DB and cache clients directly. |
| ORM | **Drizzle** (over Prisma) | You can define RLS policies and roles in the schema, it's SQL-first, and running `set_config()` per transaction is easy. There's no engine binary in the Docker image. |
| Auth | **Better Auth**, email + password, for platform users | Lucia is deprecated. Auth.js is now maintained by the Better Auth team, who recommend Better Auth for new projects. It includes admin impersonation and 2FA plugins. |
| Customer auth | Our own small session module (per store, host-only cookie) | Customers belong to one store and log in on that store's own host, which can be a custom domain, so they can't share the platform cookie. |
| DB | PostgreSQL 18 (`uuidv7()` built in) | Time-ordered UUIDs. |
| Jobs | **pg-boss** (queue inside Postgres) + a separate `worker` process | Jobs are enqueued in the **same transaction** as the payment/state change, so "paid but never registered" can't happen. |
| Cache / rate limit | **Redis (Valkey)** | Shared rate-limit counters, and pub/sub to clear tenant-lookup caches across processes. |
| Storage | `StorageAdapter` → R2 via S3 API (local-disk adapter in dev) | Browser uploads go directly with presigned PUTs. Files are served from `cdn.ourplatform.com`. |
| Money | `bigint` minor units (kobo) + ISO currency | No floating-point rounding errors. |
| Tests | Vitest (unit + integration against real Postgres), Playwright later | Isolation tests need real RLS, not mocks. |

---

## 1. Folder structure

```
storebuilder/
├─ .env.example                  # every variable documented; no secrets committed
├─ docker-compose.dev.yml        # postgres + redis + mailpit for local dev (Stage 1)
├─ docker-compose.yml            # prod: caddy, app, worker, postgres, redis (Stage 11)
├─ Dockerfile                    # multi-stage, Next.js standalone output
├─ caddy/
│  ├─ Caddyfile                  # wildcard + on-demand TLS
│  └─ Dockerfile                 # xcaddy build with the DNS provider module
├─ drizzle.config.ts
├─ next.config.ts
├─ db/
│  ├─ migrations/                # drizzle-kit output + hand-written SQL (roles, RLS, triggers)
│  └─ seed.ts                    # plans, reserved subdomains, super admin, demo store
├─ docs/                         # ARCHITECTURE.md, DOMAINS.md, DEPLOY.md, adr/
├─ worker/
│  └─ index.ts                   # pg-boss worker: domains, reminders, billing sweeps, reconciliation
├─ tests/
│  ├─ integration/               # tenant isolation, webhooks, billing state machine
│  └─ helpers/                   # test DB, factories
└─ src/
   ├─ proxy.ts                   # host → tenant resolution + internal rewrites
   ├─ app/
   │  ├─ layout.tsx              # bare root layout
   │  ├─ platform/               # app.ourplatform.com (proxy rewrites / → /platform/…)
   │  │  ├─ (marketing)/         # landing, pricing
   │  │  ├─ (auth)/              # login, signup, reset
   │  │  └─ dashboard/
   │  │     ├─ page.tsx          # store picker (a user can own/staff several stores)
   │  │     └─ [store]/          # overview, products, categories, orders, customers,
   │  │                          # settings, appearance, domains, billing, staff
   │  ├─ superadmin/             # admin.ourplatform.com → /superadmin/…
   │  │                          # stores, plans, revenue, domains queue, settings, audit
   │  ├─ s/[storeId]/            # storefront; every tenant host is rewritten here
   │  │  ├─ layout.tsx           # injects theme CSS variables, logo, fonts
   │  │  ├─ page.tsx  c/[slug]/  p/[slug]/  search/  cart/  checkout/  account/
   │  │  ├─ unavailable/         # "temporarily unavailable" (503)
   │  │  ├─ sitemap.xml/route.ts
   │  │  └─ robots.txt/route.ts
   │  └─ api/
   │     ├─ auth/[...all]/       # Better Auth handler
   │     ├─ webhooks/paystack/platform/
   │     ├─ webhooks/paystack/store/[storeId]/
   │     ├─ uploads/presign/
   │     └─ internal/tls-ask/    # Caddy on-demand TLS check (blocked publicly at Caddy)
   ├─ server/                    # server-only (import 'server-only')
   │  ├─ env.ts                  # zod-validated env
   │  ├─ db/
   │  │  ├─ schema/              # platform.ts, stores.ts, catalog.ts, commerce.ts, billing.ts, domains.ts, ops.ts
   │  │  ├─ pools.ts             # tenantPool (role app_tenant) + platformPool (role app_platform)
   │  │  └─ tenant.ts            # withTenant(storeId, fn): tx + set_config('app.store_id', …, true)
   │  ├─ tenancy/                # resolve.ts, cache.ts, hostnames.ts, reserved.ts
   │  ├─ auth/                   # platform auth config, customer-session.ts, guards.ts
   │  ├─ modules/                # business logic; each: service.ts, repo.ts, schemas.ts (zod), *.test.ts
   │  │  ├─ stores/  catalog/  orders/  customers/  cart/  checkout/  themes/
   │  │  ├─ billing/  domains/  notifications/  audit/  superadmin/
   │  ├─ payments/
   │  │  ├─ provider.ts          # PaymentProvider interface (initialize, verify, refund, parseWebhook)
   │  │  ├─ paystack/            # client, webhook verification, platform billing, store checkout
   │  │  └─ flutterwave/         # placeholder behind the same interface
   │  ├─ registrars/
   │  │  ├─ registrar.ts         # DomainRegistrar interface
   │  │  ├─ hostinger.ts         # HostingerRegistrar
   │  │  ├─ manual.ts            # ManualRegistrar (notifies super admin)
   │  │  └─ dns-check.ts         # public-resolver checks for A/CNAME/TXT
   │  ├─ storage/                # adapter.ts, s3.ts, local.ts
   │  ├─ email/                  # Mailer interface + templates
   │  ├─ jobs/                   # pg-boss setup + job names/payload schemas
   │  └─ security/               # crypto.ts (AES-256-GCM), rate-limit.ts, origin-check.ts
   ├─ components/                # ui/, storefront/, dashboard/, superadmin/
   ├─ lib/                       # money.ts, slug.ts, shared client/server utils
   └─ styles/globals.css         # Tailwind v4; theme tokens read CSS variables
```

**Isolation guardrails in code**

- Tenant modules receive only a `TenantTx` from `withTenant()`. They never see a raw pool.
- `platformPool` can be imported only from `tenancy/`, `auth/`, `payments/*/webhooks`, `modules/superadmin`, `modules/billing` (state machine) and `worker/`. ESLint `no-restricted-imports` enforces this.
- Postgres RLS is the second line of defence. If the code forgets a tenant filter, it gets zero rows, not another store's rows.

---

## 2. Database schema

The full DDL is in `schema-proposal.sql`: 38 tables and 30 RLS policies.

### 2.1 Isolation model

- Every tenant table has `store_id NOT NULL` plus `UNIQUE (store_id, id)`. Children reference parents with **composite FKs** (`(store_id, product_id) → products(store_id, id)`). This makes a cross-store reference impossible at the database level.
- RLS policy on every tenant table: `store_id = current_store_id()`, where `current_store_id()` reads the transaction-local setting `app.store_id`. If it isn't set, it returns `NULL`, so no rows match (fails closed).
- Roles: `app_tenant` (RLS enforced; used for all store-scoped work) and `app_platform` (`BYPASSRLS`; used only by the modules listed above). Migrations run as the schema owner.
- `audit_logs` is append-only (UPDATE/DELETE revoked from both roles). The tenant role can write Paystack secret keys but can't `SELECT` the ciphertext back.

### 2.2 Tables

**Platform & identity (no RLS, platform code only)**

| Table | Purpose / key columns |
|---|---|
| `users` | Platform users: owners, staff, super admins. `email citext unique`, `platform_role`, `two_factor_enabled`, `banned_at` |
| `auth_accounts`, `auth_sessions`, `auth_verifications` | Auth library tables. `auth_sessions.impersonated_by` supports support impersonation |
| `reserved_subdomains` | www, app, admin, api, mail, cdn, … (super admin can add more) |
| `platform_settings` | Key/value: domain markup, USD→NGN rate, trial/grace days |
| `plans` | `code`, `price_minor` per year, `max_products`, `max_staff`, `custom_domain_allowed`, `features jsonb` |
| `webhook_events` | Raw inbound webhooks. `UNIQUE (provider, scope, idempotency_key)` |

**Tenant & settings**

| Table | Purpose / key columns |
|---|---|
| `stores` | Tenant root. `subdomain` (regex-checked), `billing_status` (denormalised for fast lookup), `trial_ends_at`, `admin_suspended_at`, `currency` (NGN), `timezone`, `onboarding jsonb`, `next_order_number` |
| `store_members` | `(store_id, user_id)` PK, `role` owner/admin/staff. Exactly one owner (partial unique index) |
| `store_invitations` | Staff invites. `token_hash`, `expires_at` |
| `store_themes` | 1:1 with store. Five colours (hex-checked), `font_heading`/`font_body` from a curated list, `logo_media_id`, `favicon_media_id`, `hero jsonb`, `version` (cache key) |
| `media` | Every uploaded file. `storage_key`, `content_type` (allowlist), size, dimensions |
| `shipping_methods` | Name, price, free-over threshold, regions (state codes), ETA |

**Billing (RLS; written by platform billing code)**

| Table | Purpose / key columns |
|---|---|
| `subscriptions` | One per store. `plan_id`, `status`, `trial_ends_at`, `current_period_start/end`, `grace_ends_at`, `auto_renew`, Paystack customer/subscription codes, encrypted card authorization, `version` (optimistic lock) |
| `subscription_payments` | `kind` new/renewal/upgrade, `amount_minor`, `status`, `UNIQUE (provider, provider_reference)`, period covered |

**Domains (RLS)**

| Table | Purpose / key columns |
|---|---|
| `domain_contacts` | Registrant details per store. `registrar_profiles jsonb` maps TLD to Hostinger WHOIS profile id |
| `domains` | `hostname` (unique among non-removed), `kind` purchased/external, `status`, `registrar`, `is_primary`, `include_www`, `verification_token`, DNS check bookkeeping, `expires_at`, `ssl_ready_at` |
| `domain_orders` | Registration/renewal purchases with a **quote snapshot**: registrar cost + currency, renewal cost, FX rate, markup, NGN price, `quote_expires_at`. Also `payment_reference`, retry fields (`attempts`, `next_attempt_at`, `last_error`) |
| `domain_order_events` | Append-only timeline. Feeds the super-admin failures queue |

**Catalog (RLS)**

| Table | Purpose / key columns |
|---|---|
| `categories` | Nested (`parent_id`), `slug` unique per store |
| `products` | `title`, `slug`, `status` draft/active/archived, `options jsonb` (e.g. Size, Colour), SEO fields, soft delete. GIN FTS index for search |
| `product_categories` | Many-to-many |
| `product_variants` | Every product has ≥1 variant. `price_minor`, `compare_at_price_minor`, `stock_quantity`, `track_inventory`, `allow_backorder`, `option_values jsonb` (unique per product), SKU unique per store |
| `product_images` | Links to `media`, optional `variant_id`, `position` |

**Customers & commerce (RLS)**

| Table | Purpose / key columns |
|---|---|
| `customers` | Per store: `UNIQUE (store_id, email)`. `password_hash` is null for guests |
| `customer_sessions`, `customer_tokens`, `customer_addresses` | Store-scoped sessions (hashed tokens), verify/reset tokens, address book |
| `carts`, `cart_items` | Anonymous cart via hashed cookie token. Items reference variants |
| `orders` | `order_number` unique per store, `status` pending/paid/shipped/delivered/cancelled, money breakdown with `CHECK` that total = subtotal + shipping + tax − discount, address and shipping snapshots, `inventory_committed` |
| `order_items` | Snapshots of title/variant/SKU/price. `CHECK line_total = unit × qty` |
| `order_status_history` | Who changed what, when |
| `payment_provider_credentials` | Store's own Paystack keys per mode. `secret_key_enc` (AES-256-GCM), `enc_key_version` for rotation, `last_webhook_at` |
| `store_payments` | Customer payment attempts. `UNIQUE (provider, reference)` |

**Ops**

| Table | Purpose / key columns |
|---|---|
| `audit_logs` | Actor, impersonator, action, entity, `changes jsonb` (secrets redacted), IP, UA. Append-only |
| `notifications` | Email/in-app. `dedupe_key UNIQUE` makes each reminder send once (e.g. `trial_ending:7d:<store>:<date>`) |

Background jobs use pg-boss's own `pgboss` schema.

### 2.3 Verified against a real Postgres

The DDL loads without errors. Then, connected as `app_tenant`:

- With no tenant set, `products` returns 0 rows.
- As tenant A, only A's product is visible, and only 1 `stores` row.
- Inserting a row with store B's id fails with an RLS violation.
- Updating B's product changes 0 rows.
- A variant pointing at B's product fails with a composite FK violation.
- Reading `secret_key_enc` or `users` gives permission denied.
- Deleting from `audit_logs`, even as `app_platform`, gives permission denied.

The same checks become the Stage 1 integration tests.

---

## 3. Tenant resolution flow

```
Browser ──TLS──> Caddy ──(Host header preserved)──> Next.js proxy.ts ──rewrite──> route
```

`proxy.ts`, for every non-static request:

1. **Normalise the host**: lowercase, strip port and trailing dot. Delete any client-sent `x-store-id` header.
2. **Block internal prefixes.** Direct requests to `/s/*`, `/platform/*` or `/superadmin/*` get a 404. These paths are only reachable by rewrite.
3. **Route by host:**
   - `ourplatform.com`, `www.ourplatform.com` → 308 redirect to `app.ourplatform.com` (or serve marketing there; your call).
   - `app.ourplatform.com` → rewrite to `/platform{path}`. Dashboard pages then check the session and store membership.
   - `admin.ourplatform.com` → rewrite to `/superadmin{path}`. Requires `platform_role = super_admin` (+ 2FA in Stage 10).
   - `{sub}.ourplatform.com` → resolve by `stores.subdomain`.
   - anything else → resolve by `domains.hostname` with `status = 'active'`. This also matches `www.<hostname>` when `include_www` is set.
4. **Resolve.** Check the in-process LRU (60 s TTL; not-found cached for 15 s). On a miss, run one indexed query on the platform pool. The result is `{ storeId, primaryHost, storefrontOpen, themeVersion }`. When a domain, status or theme changes, a Redis pub/sub message evicts the entry in every process.
5. **Not found** → platform-branded "store not found" page (404).
6. **Canonical host.** If the store has a primary custom domain and the request came in on another host, 301 to the primary host with the same path. This is good for SEO, and customer sessions live on one host.
7. **Closed** (grace expired, suspended, cancelled or admin-suspended) → rewrite to `/s/{id}/unavailable` with status 503.
8. **Otherwise** → rewrite to `/s/{storeId}{path}`. Pages read `storeId` from params.

Storefront data uses `'use cache'` + `cacheTag('store:{id}')`, `store:{id}:products`, etc. Dashboard mutations call `updateTag` or `revalidateTag(tag, 'max')`. Both hosts of a store share one cache, because the cache key is the store id, not the hostname.

**Dashboard URLs** look like `app.ourplatform.com/dashboard/{subdomain}/products`. Each request resolves the store, checks `store_members` for the session user, then runs everything inside `withTenant(storeId, …)`.

**Cookies are host-only.** The platform session lives only on `app.`. Super admin signs in on `admin.`. Customer sessions live on the store's primary host. Nothing is scoped to `.ourplatform.com`, so no store subdomain ever receives a platform session cookie.

**Access rules** (one function, `getStoreAccess()`):

| Store state | Storefront | Dashboard |
|---|---|---|
| trialing, active | open | full |
| past_due (within 7-day grace) | open + owner banner | full + banner |
| suspended (grace over), cancelled | 503 page | read-only (billing still works) |
| admin-suspended | 503 page | read-only + reason |

---

## 4. Domain connection flows

### 4.1 Buying a domain through the platform

```
search ─> quote ─> pay (Paystack) ─> webhook ─> [job] register ─> [job] set DNS ─> [job] verify ─> active ─> TLS on first hit
```

1. **Search.** The owner enters a name, and we call `POST /api/domains/v1/availability` with several TLDs in one request.
   - Hostinger caps this endpoint at **10 requests per minute**, so results are cached for 10 minutes and searches are rate-limited per store.
   - The available TLDs come from a super-admin list.
2. **Quote.** Price is `registrar cost (catalog, USD cents) × FX rate × (1 + markup%) + fixed markup`, rounded (e.g. to the nearest ₦500).
   - The owner sees both the **first-year and renewal** prices, since registrars often renew higher. For example, Hostinger's public .ng price is $24.99 first year and $32.99 renewal.
   - The catalog is cached daily. The quote is saved on `domain_orders` and is valid for 30 minutes.
3. **Checks before payment.** The plan must have `custom_domain_allowed`. The registrant contact form (`domain_contacts`) must be complete, because the store owner should be the legal registrant.
4. **Pay.** We create `domains(status = pending_payment)` and `domain_orders(pending_payment)`, then call Paystack transaction initialize with our platform keys and metadata `{kind: 'domain_order', id}`.
5. **Webhook.** On `charge.success`:
   - verify the HMAC-SHA512 signature and dedupe by body hash;
   - check that amount and currency match the quote;
   - in **one transaction**: order → `paid`, domain → `registering`, and enqueue `domain.register`.
6. **`domain.register`** (worker):
   - Check whether the domain is already in our Hostinger portfolio (`GET /api/domains/v1/portfolio`). This makes retries safe against a double purchase.
   - Re-check availability, and make sure a WHOIS profile exists for this TLD (`POST /api/domains/v1/whois`).
   - Buy with `POST /api/domains/v1/portfolio {domain, item_id, domain_contacts, payment_method_id?}`. Hostinger charges **our** saved payment method.
   - Success → domain `dns_pending`, and enqueue `domain.configure_dns`.
   - Transient error (5xx, 429) → exponential backoff, 6 attempts over about 6 hours.
   - Hard error (taken, TLD rule failure) → `failed`, automatic Paystack refund, owner notified, and it appears in the super-admin queue.
7. **`domain.configure_dns`** → `POST /api/dns/v1/zones/{domain}/validate`, then `PUT /api/dns/v1/zones/{domain}` with `overwrite: true`: `A @ → VPS_IP` and `CNAME www → @`. The zone may not exist for a few minutes after purchase, so this retries.
8. **`domain.verify`.** Every few minutes, check public resolvers (1.1.1.1 and 8.8.8.8). Once the A record points to us:
   - domain → `active` and the tenant cache is evicted;
   - an HTTPS probe triggers certificate issuance and sets `ssl_ready_at`;
   - the owner gets an email and can mark the domain as primary.

**ManualRegistrar fallback.** The flow is identical, except that at `registering` the super admin gets an email and an entry in the queue. They register the domain elsewhere, enter the expiry date and click "Mark registered". It then moves to `dns_pending`, and the same verifier takes over. Super admins can also switch a failed Hostinger order to manual.

### 4.2 Connecting a domain the owner already has

1. The owner enters `shop.acme.com` or `acme.com`. We validate the syntax, check the public-suffix list (via `tldts`), refuse our own domain and IP addresses, and check it's unique across all stores.
2. Create `domains(kind = external, status = dns_pending)` with a random `verification_token`.
3. Show instructions:
   - `TXT _ourplatform-verify.<host> = <token>`, which proves ownership;
   - apex domain → `A @ <VPS_IP>`;
   - subdomain → `CNAME shop → stores.ourplatform.com`;
   - `www` → CNAME to the apex, or to `stores.ourplatform.com`.
4. Verification runs when the owner clicks "Check now", plus a job every 10 minutes for 72 hours and then daily for 7 days, after which it's marked `failed` with the exact record that's wrong. When the TXT matches and routing points to us → `active`.
5. A daily re-check of active external domains. If DNS has moved away for 3 or more days → `failed` and the owner is notified. The TLS `ask` endpoint then stops approving it.

### 4.3 SSL with Caddy

```caddyfile
{
  email ops@ourplatform.com
  on_demand_tls {
    ask http://app:3000/api/internal/tls-ask
  }
}

# Platform + every store subdomain: ONE wildcard cert via DNS-01
ourplatform.com, *.ourplatform.com {
  tls {
    dns cloudflare {env.CF_API_TOKEN}     # or: dns hostinger {env.HOSTINGER_API_TOKEN}
  }
  @internal path /api/internal/*
  respond @internal 404
  reverse_proxy app:3000
}

# Custom domains: cert issued on first request, only if our DB says yes
https:// {
  tls { on_demand }
  @internal path /api/internal/*
  respond @internal 404
  reverse_proxy app:3000
}
```

- `tls-ask?domain=x` returns 200 only when `x` (or `x` without its `www.` prefix, when `include_www` is set) is a domain in `active` status. This stops strangers pointing random domains at us to drain certificate quota.
- The **wildcard is required.** Let's Encrypt allows 50 certificates per registered domain per 7 days, so per-subdomain certificates would stall signups at about 50 per week. A wildcard needs the DNS-01 challenge, which means Caddy needs a DNS-provider module for wherever `ourplatform.com`'s DNS lives.

### 4.4 Renewals

- Sixty, thirty and seven days before `expires_at`, we create a renewal `domain_order` and send the invoice.
- On payment we call `POST /api/billing/v1/subscriptions/{id}/renew`. Hostinger domains appear as billing subscriptions, and each domain's subscription id is stored in `domains.registrar_ref`. `GET /api/domains/v1/portfolio/{domain}/renewal` confirms the new expiry.
- Hostinger auto-renew stays **off** by default (`DELETE …/auto-renewal/disable`), so we never pay for a domain the customer hasn't paid for.
- Fourteen days before expiry, unpaid domains go to a super-admin alert. You can choose to renew and absorb the cost.

---

## 5. Billing state machine (affects the schema, built in Stages 5–6)

```
signup ─> trialing ──trial_ends_at──> past_due ──grace_ends_at (+7d)──> suspended
              │                          │                                  │
              └──────── payment ─────────┴────────────── payment ───────────┴──> active ──period_end──> past_due …
```

- An hourly sweeper job applies time-based transitions. Payments apply event-based ones. Every transition goes through one function, guarded by an optimistic `version` check, writes an `audit_logs` row and updates `stores.billing_status` in the same transaction.
- Paying early extends from `max(now, current_period_end)`.
- **Upgrade:** charge the prorated difference for the remaining days.
- **Downgrade:** at period end, and only if the store is within the new plan's limits.

---

## 6. What Hostinger's API actually supports (checked against the docs, Sept 2026)

Base URL `https://developers.hostinger.com`. Bearer token created in hPanel → API. Limit is **90 requests/min per user**, and 429 is returned above that.

| Need | Endpoint | Notes |
|---|---|---|
| Availability | `POST /api/domains/v1/availability` | Several TLDs per call. Alternatives only when one TLD is sent. **10 req/min**. Response: `domain`, `is_available`, `is_alternative`, `restriction`. **No price.** |
| Price | `GET /api/billing/v1/catalog` | Price items: `id`, `currency`, `price` and `first_period_price` **in cents**, `period`, `period_unit`. The item `id` is what purchase needs |
| Register | `POST /api/domains/v1/portfolio` | `domain`, `item_id` (required); `payment_method_id` (defaults to the account's default), `domain_contacts`, `additional_details` (some TLDs), `coupons`. Charges **our** Hostinger payment method |
| WHOIS | `POST/GET/DELETE /api/domains/v1/whois…` | A WHOIS profile must exist per TLD. Without one, the account's default contact for that TLD is used |
| DNS | `GET/PUT/DELETE /api/dns/v1/zones/{domain}`, `POST …/validate`, `POST …/reset`, snapshots | `PUT` with `overwrite=true` replaces records. Otherwise it upserts |
| Nameservers | `PUT /api/domains/v1/portfolio/{domain}/nameservers` | |
| Status / expiry | `GET /api/domains/v1/portfolio/{domain}`, `GET …/renewal` | |
| Renew | `POST /api/billing/v1/subscriptions/{id}/renew` | Creates a renewal order and charges the default payment method |
| Auto-renew | `PATCH …/auto-renewal/enable`, `DELETE …/auto-renewal/disable` | |
| Hand-over | `GET …/portfolio/{domain}/auth-code`; "Move" endpoints | Transfer out to another registrar, or move to the customer's own Hostinger account |
| Webhooks | **None found** | We poll |

---

## 7. Risks and open questions

### Questions I need answered before Stage 1

1. **What's the real platform domain, and where is its DNS?** For the wildcard certificate I recommend putting `ourplatform.com` DNS on **Cloudflare** (free, DNS-only), using the official `caddy-dns/cloudflare` module. Keeping DNS at Hostinger works only through a community module (`caddy-dns-hostinger`, v0.1.x, not official).
2. **Drizzle OK?** You offered Prisma or Drizzle. I recommend Drizzle for the RLS work.
3. **Better Auth OK?** You named Auth.js or Lucia. Lucia is deprecated, and Auth.js's maintainers now point new projects to Better Auth.
4. **Where should the code live?** Options: a new folder on your Mac connected to this session, or a GitHub repo I push to. Your Downloads folder is the only one connected right now.

### Risks, plus decisions needed before the stage in brackets

1. **Hostinger's Terms of Service forbid reselling without consent (big one) [Stage 8].** Clause 6.6: *"You shall not re-sell or otherwise exploit for commercial purposes any of the Services … without Hostinger's express prior written consent."* Their reseller programme covers cPanel hosting, not domains. **Please get written consent from Hostinger before launching paid domain resale.**
   - If they say no, the `DomainRegistrar` interface lets us switch to a registrar with a real reseller API, or to a NiRA-accredited Nigerian registrar for .ng/.com.ng, without touching the rest of the app. `ManualRegistrar` works on day one regardless.
2. **Who is the registrant [Stage 8]?** Domains sit in *our* Hostinger account. Hostinger's terms say a third-party registrant can ask them for access. I recommend making the **store owner the registrant** (their WHOIS profile), and offering the auth code or a Move on request after any lock period. Please confirm.
3. **FX and cost exposure [Stage 8].** Hostinger bills in USD to our card, while customers pay in NGN. The markup needs an FX buffer, and super admin sets the rate (or we fetch it daily). Renewal prices are higher than first-year prices, so we show both.
4. **No sandbox [Stage 8].** Every test registration costs real money. I'll build against a mocked registrar and do one live test with a cheap TLD.
5. **Availability limit of 10 per minute across the whole platform [Stage 8].** Handled with caching, batching TLDs per call, per-store limits and a queue. Heavy use may still need a public RDAP pre-check.
6. **.com.ng [Stage 8].** Hostinger publicly lists `.ng`. I couldn't confirm `.com.ng`, and will check it through the availability endpoint. How important is `.com.ng` to your customers?
7. **Paystack recurring billing [Stage 6].** Paystack Subscriptions support `annually`, but only by **card or Nigerian direct debit**.
   - Many Nigerian businesses prefer bank transfer or USSD. I recommend **self-managed yearly billing**: a one-off Paystack payment through any channel, with our own reminders and period tracking. Card payers can opt into auto-renew through a stored authorization.
   - The alternative is Paystack-managed subscriptions (card or direct debit only). Which do you prefer?
8. **Store payment webhooks [Stage 7].** A Paystack account has **one webhook URL**. A merchant already using Paystack on another site can't point it at us without breaking that site.
   - Plan: verify on the checkout callback (server-side `verify`), and run a reconciliation job that re-verifies pending payments every few minutes. The webhook becomes optional.
   - The alternative is Paystack **subaccounts** under our account: no merchant keys, split settlement straight to their bank. But we become the merchant of record. Stay with the keys as specified?
9. **Domains during the trial [Stage 8].** I propose that buying or connecting a custom domain requires a **paid** plan with `custom_domain_allowed`. Otherwise someone could buy a domain, never subscribe, and leave us holding a domain tied to a dead store. OK?
10. **Apex A records pin customers to our IP.** Customers who connect their own apex domain point an A record at the VPS, so changing the VPS IP later means every one of them must update DNS. Subdomain customers use a CNAME that we control. A Hostinger VPS IP is static, but keep this in mind for a future move.
11. **Single VPS [Stage 11].** One VPS is a single point of failure. The plan covers nightly `pg_dump` to R2, health checks and a restore runbook. Fine for launch.
12. **Email provider [Stage 10].** Resend, Brevo, Amazon SES or ZeptoMail? It's all behind a `Mailer` interface, and dev uses Mailpit.
13. **Fonts.** `next/font` needs fonts known at build time, so the theme customizer offers about 8–10 curated Google fonts rather than any font.

---

## 8. Stage 1 scope (once approved)

- Project scaffold (Next 16, TS strict, Tailwind v4, ESLint with import boundaries, Vitest) and `docker-compose.dev.yml` (Postgres 18, Redis, Mailpit).
- Drizzle schema for the **Stage 1–2 tables**. Migrations include roles, RLS and triggers. Other tables arrive in their own stages, following this proposal.
- `env.ts` with zod and a documented `.env.example`.
- `withTenant()` data-access layer and the two pools.
- Better Auth email + password for platform users, and guards (`requireUser`, `requireStoreRole`, `requireSuperAdmin`).
- `proxy.ts` tenant resolution with LRU cache, rewrites, canonical-host redirect and blocked internal prefixes.
- Placeholder pages for each surface: the `app.` landing and dashboard shell, the `admin.` shell, and a storefront home showing the resolved store.
- Local subdomain dev using `*.localhost` (e.g. `demo.localhost:3000`). Chrome and Firefox resolve it to 127.0.0.1 without editing `/etc/hosts`.
- Seed script: plans, reserved names, a super admin, two demo stores.
- Tests: tenant isolation (the §2.3 checks), host parsing, reserved and invalid subdomains, resolution cache.
- README: local setup.

---

## Sources

- Hostinger API reference: https://docs.hostinger.com/api-reference/overview (redirected from developers.hostinger.com)
- Hostinger SDK docs (request/response models): https://github.com/hostinger/api-python-sdk/tree/main/docs
- Hostinger Terms of Service: https://www.hostinger.com/legal/universal-terms-of-service-agreement
- Hostinger reseller agreement: https://www.hostinger.com/legal/reseller-master-agreement
- Hostinger .ng pricing: https://www.hostinger.com/tld/ng-domain
- Next.js 16 release (proxy.ts, caching APIs): https://nextjs.org/blog/next-16
- Auth.js joins Better Auth: https://better-auth.com/blog/authjs-joins-better-auth
- Lucia deprecation: https://github.com/lucia-auth/lucia/discussions/1707
- Paystack Subscriptions: https://paystack.com/docs/payments/subscriptions/
- Let's Encrypt rate limits: https://letsencrypt.org/docs/rate-limits/
- caddy-dns-hostinger (community): https://pkg.go.dev/github.com/sbrunk/caddy-dns-hostinger
