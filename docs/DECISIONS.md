# Decisions log

Decisions made after the original proposal (`PROPOSAL.md`). Newest first.

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
- Created now: `users`, the auth tables, `reserved_subdomains`, `platform_settings`, `stores`, `store_members`, `domains`.
- Every other table from `schema-proposal.sql` arrives in the stage that uses it.
- `stores.billing_status` is only changed by platform code. The trial → grace → suspended sweeper is Stage 6.

### Deferred
- **Redis:** until rate limiting needs it (Stage 10).
- **pg-boss:** until the VPS.
- **Theme fonts (Stage 4):** `next/font` needs fonts at build time. Local builds here can't reach Google Fonts, so the platform uses the self-hosted `geist` package. The storefront font list will use self-hosted packages as well.
