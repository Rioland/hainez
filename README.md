# Hainez: multi-tenant store builder

One Next.js codebase and one Postgres database serving many isolated online stores. Businesses sign up, get a free subdomain and a 30-day trial, then pay yearly. Each store gets its own branded storefront and admin dashboard.

> **Status: Stage 2 of 11.**
> - **Stage 1:** project setup, schema, auth, tenant resolution, subdomain/path routing.
> - **Stage 2:** store admin (products with variants and images, categories, orders with stock handling, customers, settings and delivery options, overview).
>
> See [`docs/PROPOSAL.md`](docs/PROPOSAL.md) for the full plan and [`docs/DECISIONS.md`](docs/DECISIONS.md) for decisions made since.

## Stack

| | |
|---|---|
| Framework | Next.js 16 (App Router, TypeScript, `proxy.ts`) |
| Database | PostgreSQL + Drizzle ORM, row-level security per store |
| Auth | Better Auth (email + password) for platform users |
| Styling | Tailwind CSS v4 |
| Tests | Vitest (unit + integration against a real Postgres) |
| Hosting (now) | Vercel + Neon Postgres |

## How requests reach a store

`src/proxy.ts` reads the Host header and rewrites every request to one of three internal route trees. The rules live in `src/server/tenancy/routing.ts` and are unit-tested.

| Mode | URL | Goes to |
|---|---|---|
| `subdomain` (own domain) | `app.yourbrand.com/*` | `/platform/*`: marketing, login, dashboard |
| | `admin.yourbrand.com/*` | `/superadmin/*` |
| | `{store}.yourbrand.com/*` | `/s/{storeId}/*`: storefront |
| | any other host | custom domain lookup, then `/s/{storeId}/*` |
| `path` (`*.vercel.app`) | `/`, `/login`, `/dashboard/*` | platform |
| | `/admin/*` | super-admin |
| | `/store/{store}/*` | storefront |

The internal prefixes (`/platform`, `/superadmin`, `/s`) return 404 if requested directly. Closed stores get a 503 "temporarily unavailable" page. Stores with a primary custom domain get a 301 to it (production only).

## Store isolation

- **Every tenant table has `store_id`.** Every store-scoped query runs through `withTenant(storeId, tx => …)` (`src/server/db/tenant.ts`), which does `SET LOCAL ROLE app_tenant` and sets `app.store_id` for the transaction.
- **Postgres RLS policies** on each tenant table only match the current store. If the tenant isn't set, queries return nothing.
- **The tenant role can't change its store's subdomain, billing status or suspension.** Column-level grants block it. It also has no access to platform tables such as `users`.
- **The platform connection bypasses RLS.** Only allowlisted modules may import it, and ESLint enforces this (`eslint.config.mjs`).
- **`pnpm db:migrate` fails if any table with a `store_id` lacks RLS.**
- These guarantees are covered by `tests/integration/tenant-isolation.test.ts`.

## Local setup

Requirements: Node 22+, pnpm 10, Docker.

```bash
pnpm install
cp .env.example .env              # then set BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose -f docker-compose.dev.yml up -d
pnpm db:migrate                   # applies migrations, syncs grants, checks RLS
pnpm db:seed:demo                 # super admin (from .env) + demo owner + 3 demo stores
pnpm dev
```

Open these in Chrome or Firefox (both resolve `*.localhost` to your machine):

| URL | What |
|---|---|
| http://app.localhost:3000 | Platform. Log in as `owner@demo.test` / `demo-password-123` (or `staff@demo.test`, same password, staff role) |
| http://admin.localhost:3000 | Super admin (`SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`) |
| http://demo.localhost:3000 | Demo storefront (trialing) |
| http://closed.localhost:3000 | Suspended store (503 page) |
| http://nope.localhost:3000 | Unknown store (404 page) |

> **macOS tip:** browsers resolve `*.localhost` by themselves, but Node may not. If the terminal shows `ENOTFOUND app.localhost`, add this line to `/etc/hosts`:
> `127.0.0.1 app.localhost admin.localhost demo.localhost acme.localhost closed.localhost`

To try path mode locally, set `ROUTING_MODE=path` and open http://localhost:3000/store/demo and http://localhost:3000/admin.

### Scripts

| Command | |
|---|---|
| `pnpm dev` / `pnpm build` / `pnpm start` | Next.js |
| `pnpm lint`, `pnpm typecheck` | ESLint (incl. the tenant import guard), TypeScript |
| `pnpm test` | Unit + integration tests (needs the dev Postgres running) |
| `pnpm test:unit` | Unit tests only, no database |
| `pnpm db:generate` | Generate a migration after editing `src/server/db/schema/*` |
| `pnpm db:migrate` | Apply migrations, sync tenant grants, assert RLS |
| `pnpm db:seed` / `pnpm db:seed:demo` | Base data (+ demo stores, catalog, delivery options and orders) |

## Store admin (Stage 2)

Everything lives under `/dashboard/{store}`:

| Page | What it does |
|---|---|
| Overview | 30-day sales, orders, average order, orders to ship, top products, low stock |
| Orders | List with status tabs, search (order #, email, name) and date range. The detail page shows items, totals, customer, address and history |
| Products | Search by title/SKU, filter by status or category, paginated. The editor has options → variant matrix (price, compare-at, SKU, stock per variant), images, categories and SEO |
| Categories | Nested categories with product counts |
| Customers | Order count, total spent and last order per customer, plus a detail page with their orders |
| Settings | Store details and currency (owner/admin only), delivery options with price, free-over threshold, states and ETA |

**Order flow:** `pending → paid → shipped → delivered`. `pending → shipped` is for pay-on-delivery, and cancelling is allowed before shipping.
- Storefront orders **reserve stock at checkout** (pay on delivery has no payment step to wait for). Other orders take stock when they become **paid or shipped**.
- If there isn't enough stock, the change is refused and nothing is taken.
- Stock goes back if the order is cancelled.
- Every change is recorded in the order history and the audit log.

**Roles:** staff can manage products, categories and orders. Settings need admin or owner. When a store's subscription has lapsed or it's suspended, the dashboard is read-only, and the server refuses writes as well as disabling the forms.

### Image uploads

Images go straight from the browser to storage with a signed URL. The server then checks the file really is an image (its file signature, not just its type) before recording it.
- **Local development:** `STORAGE_DRIVER=local` stores files in `.data/uploads`.
- **Vercel:** you need a bucket. Cloudflare R2 is recommended.

To set up R2:

1. **Create a bucket** in Cloudflare → R2, e.g. `hainez-media`.
2. **Make it public:** Settings → Public access → turn on the `r2.dev` URL, or connect a custom domain such as `cdn.yourbrand.com`. That URL is `S3_PUBLIC_URL`.
3. **Create an API token:** R2 → Manage API tokens → "Object Read & Write" for this bucket. This gives `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and the endpoint `https://<account-id>.r2.cloudflarestorage.com`.
4. **Add a CORS policy** under bucket Settings → CORS, so browsers can upload:
   ```json
   [{ "AllowedOrigins": ["https://<your-project>.vercel.app", "http://localhost:3000"],
      "AllowedMethods": ["PUT", "GET"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```
5. **Set the environment variables:** `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`.

## Storefront (Stage 3)

Each store is served at `{store}.<root>` (or its custom domain), or `/store/{store}` in path mode. Every link carries that base path, so both modes work.

| Page | What it does |
|---|---|
| Home `/` | Featured products, top-level categories, new arrivals |
| Category `/c/{slug}` | Products in the category and its sub-categories; sort by newest or price; paginated |
| Search `/search?q=` | Full-text search over titles and descriptions (not indexed by search engines) |
| Product `/p/{slug}` | Gallery, option pickers that grey out sold-out combinations, stock hints, add to cart |
| Cart `/cart` | Change quantities, remove lines. Lines whose product changed (sold out, less stock, unpublished) are flagged and block checkout |
| Checkout `/checkout` | Contact and address, delivery options filtered by state, pay on delivery |
| Order `/order/{id}?t=…` | Confirmation and status. The `t` token is the guest's private link to the order |
| Account `/account`, `/account/login`, `/account/register` | Optional customer accounts per store, with order history |

**Try it locally:** `pnpm db:seed:demo`, `pnpm dev`, then open http://demo.localhost:3000, add something to the cart and check out. The order appears in the owner's dashboard at http://app.localhost:3000/dashboard/demo/orders.

How it behaves:
- **Prices come from the database** at every step. The cart shows live prices, and checkout recomputes items and delivery on the server.
- **Stock is reserved when the order is placed** (variant rows locked, so two shoppers can't both buy the last one). Cancelling in the dashboard returns it.
- **Carts** live in the database. The browser only holds a random token in an httpOnly cookie, scoped to the store's host (and to `/store/{name}` in path mode).
- **Customer accounts belong to one store.** The same email on two stores is two accounts. A signed-in customer sees orders placed while signed in. Earlier guest orders with the same email appear once the email is verified (email arrives in Stage 10), so nobody can read someone else's orders by registering their address.
- **Limits:** checkout 10 per 10 minutes, sign-in 10 and sign-up 5 per 15 minutes, per store and IP.
- **SEO:** per-page titles and descriptions, canonical URLs on the store's primary host, Open Graph images, Product JSON-LD, plus `/sitemap.xml` and `/robots.txt` per store. Cart, checkout, account and order pages are `noindex`.
- **Caching:** catalog reads are cached per store for up to an hour. Dashboard edits expire the store's cache immediately.

## Deploying to Vercel + Neon (no custom domain yet)

1. **Import the GitHub repo** in Vercel (framework: Next.js).
2. **Add Neon** from Vercel → Storage → Marketplace → Neon. It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`.
3. **Set environment variables:**
   - `BETTER_AUTH_SECRET`: 32+ random characters.
   - `ROUTING_MODE=path`.
   - `PLATFORM_NAME`: optional.
   - `SEED_SUPERADMIN_EMAIL` and `SEED_SUPERADMIN_PASSWORD`: for the first seed.
   - `ROOT_DOMAIN` can stay unset; Vercel's production URL is used.
   - For image uploads, the `S3_*` variables (see "Image uploads" above).
4. **Set Build Command** to `pnpm vercel-build`. It runs migrations, then `next build`.
5. **Deploy, then seed once from your machine** against the Neon URL:
   `DATABASE_URL=<neon unpooled url> SEED_SUPERADMIN_EMAIL=… SEED_SUPERADMIN_PASSWORD=… pnpm db:seed`
6. **Open the deployment:**
   - `https://<project>.vercel.app` for the platform;
   - `/admin` for super admin;
   - `/store/<name>` for storefronts.

**When you buy a domain:** add `yourbrand.com` and `*.yourbrand.com` to the Vercel project. Wildcards require Vercel's nameservers. Then set `ROUTING_MODE=subdomain` and `ROOT_DOMAIN=yourbrand.com`.

> Vercel's Hobby plan is for non-commercial use only. Move to Pro before stores take real payments.

## Project layout

```
src/
  proxy.ts                     host → tenant resolution + rewrites
  app/
    platform/                  app.<root>: landing, login, signup, dashboard/[store]
    superadmin/                admin.<root>: login, stores list
    s/[storeId]/               storefront: home, c/, p/, search, cart, checkout, order/, account/, sitemap.xml, robots.txt
    store-not-found/           platform-branded 404 for unknown stores
    api/auth/[...all]/         Better Auth handler (platform hosts only)
  server/
    env.ts                     zod-validated environment
    db/schema/*                Drizzle schema (+ RLS policies)
    db/platform.ts             platform connection (RLS bypass, allowlisted)
    db/tenant.ts               withTenant()
    tenancy/                   routing rules, resolver + cache, access rules, URLs
    auth/                      Better Auth config, guards, memberships
    modules/                   catalog, orders, customers, settings, media, overview, audit, superadmin, storefront
    storage/                   StorageAdapter: S3/R2 + local disk
drizzle/                       SQL migrations (0000 bootstrap roles/functions, 0001 tables, 0002 grants, … 0005–0006 storefront)
scripts/                       migrate.ts, seed.ts
tests/                         unit/ and integration/
docs/                          PROPOSAL.md, DECISIONS.md, schema-proposal.sql
```
