# Handoff: continuing this project in Claude Code

Read this first, then `README.md`, `docs/DECISIONS.md` (newest first) and `docs/PROPOSAL.md` (the approved plan and schema). `AGENTS.md` applies too: this is Next.js 16, so check `node_modules/next/dist/docs/` before using an API from memory.

## Where things stand

- Multi-tenant e-commerce SaaS. Repo: https://github.com/Rioland/hainez (branch `main`). Display name comes from `PLATFORM_NAME` (default "StoreBuilder").
- Stack: Next.js 16 (App Router, TypeScript), PostgreSQL + Drizzle 0.45, Tailwind 4, Better Auth 1.7, Zod 4, Vitest. Runs on Vercel + Neon for now (path routing mode); the long-term target is a Hostinger VPS with Caddy.
- **Done:** Stage 1 (setup, schema, auth, tenant proxy and routing), Stage 2 (store admin), Stage 3 (storefront: browsing, cart, checkout, customer accounts). 102 tests passing.
- **Stage 3 is awaiting the owner's approval.** Next is **Stage 4: theme customizer and logo uploads.**

Remaining stages:
4. Theme customizer and logo uploads
5. Signup with 30-day trial
6. Paystack subscriptions (platform billing)
7. Per-store customer payments (each store's own Paystack)
8. Custom domains, Hostinger registrar and DNS, SSL
9. Super-admin
10. Emails, audit, hardening, tests
11. Docker and deployment

## How we work (from the owner's brief)

- Build one stage at a time. After each stage: summarize what was built and how to run and test it, list decisions and assumptions, then **stop and wait for approval** before the next stage.
- Keep code clean, typed, and commented where the logic isn't obvious.
- Never hard-code secrets. Every new variable goes in `.env.example` with a comment.
- Record decisions in `docs/DECISIONS.md` (newest stage first) and user-facing docs in `README.md`.
- Commit at the end of each stage and push to `origin main`.

## Local setup

```
pnpm install
docker compose -f docker-compose.dev.yml up -d   # Postgres 18 (+ Mailpit) with msb_dev and msb_test
cp .env.example .env                              # then set BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm db:migrate
pnpm db:seed:demo
pnpm dev
```

- Platform: http://app.localhost:3000 · Super admin: http://admin.localhost:3000 · Store: http://demo.localhost:3000
- Demo logins: owner@demo.test / demo-password-123 (staff@demo.test, same password). The super admin is whatever `SEED_SUPERADMIN_EMAIL` / `SEED_SUPERADMIN_PASSWORD` say in `.env`.
- Demo stores: `demo` (trialing), `acme` (custom domain acme-fashion.test), `closed` (suspended).
- Path mode (like Vercel): `ROUTING_MODE=path`, then `/store/demo`, `/admin`, `/dashboard/demo`.

Checks before finishing a stage: `pnpm typecheck` (runs `next typegen` first), `pnpm lint`, `pnpm test` (integration tests need the `msb_test` database), `pnpm build`.

## Rules the code depends on

**Tenancy and database**
- Store-scoped queries run inside `withTenant(storeId, tx => …)` (`src/server/db/tenant.ts`). It switches to the `app_tenant` role and sets `app.store_id`, so Postgres row-level security isolates stores.
- `platformDb` (`src/server/db/platform.ts`) bypasses RLS. An ESLint allowlist limits who may import it; don't widen it casually.
- Every new store-scoped table needs `store_id`, the `tenantPolicy()` in its schema, and composite foreign keys `(store_id, x_id)`. Drizzle can't express nullable composite FKs with `ON DELETE SET NULL (col)`: put those in a custom SQL migration (`pnpm drizzle-kit generate --custom --name …`), as in 0004 and 0006. `pnpm db:migrate` re-syncs grants and fails if any tenant table lacks RLS.
- Money is stored in minor units (kobo), as `bigint` in number mode.
- Correlated subqueries in select fields go through `subquery()` from `src/server/db/sql.ts`. Otherwise Drizzle drops table names and the query silently changes meaning.
- Several queries on one transaction use `inSequence()` (same file), never `Promise.all`.

**Server actions and forms**
- Dashboard actions go through `runStoreAction(subdomain, { min, write }, fn)`. Storefront actions go through `runShopAction`, which takes the store id from the proxy's `x-store-id` header and never from the client.
- **Never call `redirect()` inside a server action.** Return `{ ok: true, redirectTo }` and let the client navigate with `useActionRedirect`. Next's action redirect dropped the session cookie.
- Actions that set or delete a cookie (customer sign-in and sign-out, checkout) finish with a full page load, started inside the action callback, not in an effect.
- Action forms spread `keepValues` from `src/components/form.tsx`, so React 19's automatic reset doesn't wipe user input after a server error. Use `clearForm()` to reset on purpose.
- Validate all input with Zod on the server. Return `DomainError` for messages the user should see.

**Storefront caching**
- Catalog reads use `unstable_cache` tagged `store:{id}`, `store:{id}:catalog` and `store:{id}:settings`. Cache Components (`use cache`) is not enabled.
- Dashboard mutations call `catalogChanged()` / `settingsChanged()` (`src/server/modules/catalog/cache.ts`) to expire those tags. A theme change must expire the store's tags too.

## Pointers for Stage 4

- The plan in `docs/PROPOSAL.md` is a `store_themes` table, 1:1 with store:
  - five colours, hex-validated;
  - `font_heading` and `font_body` from a curated list of about 8–10 fonts (`next/font` needs fonts known at build time);
  - `logo_media_id` and `favicon_media_id`;
  - `hero` as jsonb;
  - `version`, used as a cache key.
- `src/app/globals.css` already defines `--brand-primary`, `--brand-primary-foreground` and `--brand-secondary`, and the storefront uses the `bg-brand` / `text-brand-foreground` utilities. Stage 4 sets these variables per store on the wrapper in `src/app/s/[storeId]/layout.tsx`, which has a comment marking the spot.
- Uploads already exist for product images: `src/server/modules/media/uploads.ts` (signed PUT URL, then a server-side check of the file signature) and the storage adapter in `src/server/storage/`. Reuse them for the logo and favicon.
- `stores.onboarding` has `{ logo, colours, first_product }` flags. The customizer should set `logo` and `colours`.
- The Settings page is `src/app/platform/dashboard/[store]/settings/`. Only owners and admins may change settings (`requireStoreRole` / `runStoreAction` with `min: "admin"`), and a read-only store must refuse writes.
