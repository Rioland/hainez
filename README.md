# Hainez: multi-tenant store builder

One Next.js codebase and one Postgres database serving many isolated online stores. Businesses sign up, get a free subdomain and a 30-day trial, then pay yearly. Each store gets its own branded storefront and admin dashboard.

> **Status: Stage 1 of 11.** Project setup, schema, auth, tenant resolution and subdomain/path routing. See [`docs/PROPOSAL.md`](docs/PROPOSAL.md) for the full plan and [`docs/DECISIONS.md`](docs/DECISIONS.md) for decisions made since.

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
| http://app.localhost:3000 | Platform. Log in as `owner@demo.test` / `demo-password-123` |
| http://admin.localhost:3000 | Super admin (`SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD`) |
| http://demo.localhost:3000 | Demo storefront (trialing) |
| http://closed.localhost:3000 | Suspended store (503 page) |
| http://nope.localhost:3000 | Unknown store (404 page) |

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
| `pnpm db:seed` / `pnpm db:seed:demo` | Base data (+ demo stores) |

## Deploying to Vercel + Neon (no custom domain yet)

1. **Import the GitHub repo** in Vercel (framework: Next.js).
2. **Add Neon** from Vercel → Storage → Marketplace → Neon. It sets `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`.
3. **Set environment variables:**
   - `BETTER_AUTH_SECRET`: 32+ random characters.
   - `ROUTING_MODE=path`.
   - `PLATFORM_NAME`: optional.
   - `SEED_SUPERADMIN_EMAIL` and `SEED_SUPERADMIN_PASSWORD`: for the first seed.
   - `ROOT_DOMAIN` can stay unset; Vercel's production URL is used.
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
    s/[storeId]/               storefront (home, unavailable, 404)
    store-not-found/           platform-branded 404 for unknown stores
    api/auth/[...all]/         Better Auth handler (platform hosts only)
  server/
    env.ts                     zod-validated environment
    db/schema/*                Drizzle schema (+ RLS policies)
    db/platform.ts             platform connection (RLS bypass, allowlisted)
    db/tenant.ts               withTenant()
    tenancy/                   routing rules, resolver + cache, access rules, URLs
    auth/                      Better Auth config, guards, memberships
    modules/                   feature modules (superadmin, storefront, …)
drizzle/                       SQL migrations (0000 bootstrap roles/functions, 0001 tables, 0002 grants)
scripts/                       migrate.ts, seed.ts
tests/                         unit/ and integration/
docs/                          PROPOSAL.md, DECISIONS.md, schema-proposal.sql
```
