-- Bootstrap: extensions, helper functions, the tenant role, and tenant-safety guards.
-- Hand-written (drizzle-kit generate --custom). Runs before any table exists.
-- Works on plain Postgres 14+, Neon and Supabase: it needs no superuser, only the
-- database owner role (CREATEROLE), which is what Neon's default role has.

CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint

-- Time-ordered UUID v7 (RFC 9562): 48-bit Unix ms timestamp + version 7 + random.
-- Postgres 18 has uuidv7() built in; this keeps us portable to older servers.
CREATE OR REPLACE FUNCTION uuid_generate_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                FROM 1 FOR 6),
        52, 1),
      53, 1),
    'hex')::uuid
$$;
--> statement-breakpoint

-- Current tenant for RLS policies. NULL when unset, so policies match nothing.
CREATE OR REPLACE FUNCTION current_store_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.store_id', true), '')::uuid
$$;
--> statement-breakpoint

-- Role used for every tenant-scoped transaction (SET LOCAL ROLE app_tenant).
-- It never logs in; the app's connection role switches into it per transaction.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant') THEN
    CREATE ROLE app_tenant NOLOGIN;
  END IF;
END $$;
--> statement-breakpoint
GRANT app_tenant TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO app_tenant;
--> statement-breakpoint

-- Grants DML to app_tenant on every table that has a tenant_isolation policy.
-- Called by scripts/migrate.ts after each migration run (idempotent), so new
-- tenant tables never ship without grants. RLS still limits rows per store.
CREATE OR REPLACE FUNCTION app_sync_tenant_grants() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT p.tablename
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.policyname = 'tenant_isolation'
      AND p.tablename <> 'stores'          -- stores gets column-level grants (see 0002)
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO app_tenant', r.tablename);
  END LOOP;
END $$;
--> statement-breakpoint

-- Fails loudly if any table with a store_id column lacks row-level security.
-- Called by scripts/migrate.ts and by the test suite.
CREATE OR REPLACE FUNCTION app_assert_tenant_rls() RETURNS void
LANGUAGE plpgsql AS $$
DECLARE missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind IN ('r', 'p')
    AND NOT c.relrowsecurity
    AND (
      c.relname = 'stores'
      OR EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.oid AND a.attname = 'store_id' AND NOT a.attisdropped
      )
    );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Tenant tables without row-level security: %', missing;
  END IF;
END $$;
