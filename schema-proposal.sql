-- =============================================================================
-- Multi-tenant e-commerce SaaS — PROPOSED database schema (PostgreSQL 18)
-- Status: proposal for review. Not a migration yet.
--
-- In Stage 1 this becomes Drizzle schema files (src/server/db/schema/*) plus
-- hand-written SQL migrations for roles, RLS policies and triggers.
--
-- Conventions
--   * Primary keys: uuid, default uuidv7() (built into PG 18; time-ordered, index friendly)
--   * Money: bigint minor units (kobo for NGN) + char(3) ISO currency. Never floats.
--   * Hostnames / subdomains: lowercase text, validated by CHECK. Emails: citext.
--   * Every tenant-owned table has store_id NOT NULL and UNIQUE (store_id, id), so
--     children reference parents with COMPOSITE foreign keys (store_id, parent_id).
--     A row can therefore never point at another store's row, even by bug.
--   * Row-level security on every tenant table, keyed on the session setting
--     app.store_id (set per transaction by the data-access layer). Unset = no rows.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS citext;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE platform_role        AS ENUM ('user', 'super_admin');
CREATE TYPE store_member_role    AS ENUM ('owner', 'admin', 'staff');
-- Billing lifecycle (mirrored on stores.billing_status for fast tenant lookup):
--   trialing -> active -> past_due (7-day grace) -> suspended -> (paid) active
--   cancelled = owner ended the subscription / store closed
CREATE TYPE billing_status       AS ENUM ('trialing', 'active', 'past_due', 'suspended', 'cancelled');
CREATE TYPE product_status       AS ENUM ('draft', 'active', 'archived');
CREATE TYPE order_status         AS ENUM ('pending', 'paid', 'shipped', 'delivered', 'cancelled');
CREATE TYPE payment_status       AS ENUM ('pending', 'success', 'failed', 'abandoned', 'refunded');
CREATE TYPE payment_provider     AS ENUM ('paystack', 'flutterwave');
CREATE TYPE provider_mode        AS ENUM ('test', 'live');
CREATE TYPE domain_kind          AS ENUM ('purchased', 'external');
-- Purchased: pending_payment -> registering -> dns_pending -> active | failed
-- External : dns_pending (awaiting owner's DNS + TXT) -> active | failed
CREATE TYPE domain_status        AS ENUM ('pending_payment', 'registering', 'dns_pending', 'active', 'failed', 'expired', 'removed');
CREATE TYPE domain_order_kind    AS ENUM ('registration', 'renewal');
CREATE TYPE domain_order_status  AS ENUM ('pending_payment', 'paid', 'registering', 'completed', 'failed', 'manual_required', 'refunded', 'expired_quote');
CREATE TYPE registrar_kind       AS ENUM ('hostinger', 'manual', 'external');
CREATE TYPE cart_status          AS ENUM ('active', 'converted', 'abandoned');
CREATE TYPE actor_type           AS ENUM ('user', 'super_admin', 'customer', 'system');
CREATE TYPE notification_channel AS ENUM ('email', 'in_app');
CREATE TYPE notification_status  AS ENUM ('queued', 'sent', 'failed', 'skipped');
CREATE TYPE webhook_status       AS ENUM ('received', 'processed', 'ignored', 'failed');

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- Current tenant for RLS. current_setting(..., true) returns NULL when unset,
-- so a query that forgot to set a tenant matches nothing (fail closed).
CREATE FUNCTION current_store_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.store_id', true), '')::uuid
$$;

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- =============================================================================
-- PLATFORM & IDENTITY (not tenant-scoped; only platform code touches these)
-- =============================================================================

-- Platform users: store owners/staff and super admins. Customers are separate
-- (see customers) because they belong to exactly one store.
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  name            text NOT NULL,
  email           citext NOT NULL UNIQUE,
  email_verified  boolean NOT NULL DEFAULT false,
  image           text,
  platform_role   platform_role NOT NULL DEFAULT 'user',
  two_factor_enabled boolean NOT NULL DEFAULT false,   -- required for super_admin (Stage 10)
  banned_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Auth tables. Exact columns follow the auth library we pick (Better Auth
-- generates these); shape shown here so the rest of the schema is complete.
CREATE TABLE auth_accounts (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id     text NOT NULL,                 -- 'credential' for email+password
  account_id      text NOT NULL,
  password_hash   text,                          -- argon2id / scrypt, never plain
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_id, account_id)
);

CREATE TABLE auth_sessions (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token           text NOT NULL UNIQUE,
  expires_at      timestamptz NOT NULL,
  ip_address      inet,
  user_agent      text,
  impersonated_by uuid REFERENCES users(id),     -- set when a super admin impersonates
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_idx ON auth_sessions (user_id);

CREATE TABLE auth_verifications (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  identifier      text NOT NULL,                 -- e.g. 'email-verify:<email>'
  value           text NOT NULL,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_verifications_identifier_idx ON auth_verifications (identifier);

-- Subdomains nobody may claim. Seeded with www, app, admin, api, mail, cdn,
-- static, assets, help, support, status, blog, docs, billing, dashboard ...
-- (also enforced in code; the table lets super admins add more).
CREATE TABLE reserved_subdomains (
  name            text PRIMARY KEY CHECK (name ~ '^[a-z0-9-]+$'),
  reason          text
);

-- Key/value platform settings editable in super-admin:
--   domain_pricing   {"markup_percent": 25, "markup_fixed_minor": 500000, "round_to_minor": 50000}
--   fx_usd_ngn       {"rate": 1550.00, "source": "manual", "updated_at": "..."}
--   billing          {"trial_days": 30, "grace_days": 7}
CREATE TABLE platform_settings (
  key             text PRIMARY KEY,
  value           jsonb NOT NULL,
  updated_by      uuid REFERENCES users(id),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Subscription plans (platform-wide catalog).
CREATE TABLE plans (
  id                     uuid PRIMARY KEY DEFAULT uuidv7(),
  code                   text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9_]+$'),  -- 'starter', 'business'
  name                   text NOT NULL,
  description            text,
  price_minor            bigint NOT NULL CHECK (price_minor >= 0),           -- per year
  currency               char(3) NOT NULL DEFAULT 'NGN',
  billing_interval       text NOT NULL DEFAULT 'year' CHECK (billing_interval IN ('year')),
  max_products           integer CHECK (max_products IS NULL OR max_products >= 0),  -- NULL = unlimited
  max_staff              integer CHECK (max_staff IS NULL OR max_staff >= 0),        -- seats excluding owner
  custom_domain_allowed  boolean NOT NULL DEFAULT false,
  features               jsonb NOT NULL DEFAULT '{}',
  paystack_plan_code     text,           -- only used if we choose Paystack-managed subscriptions
  is_active              boolean NOT NULL DEFAULT true,
  is_public              boolean NOT NULL DEFAULT true,
  sort_order             integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

-- Raw inbound webhooks (platform and per-store). Unique idempotency key makes
-- redeliveries no-ops; business-level idempotency is also enforced by unique
-- payment references and guarded state transitions.
CREATE TABLE webhook_events (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  provider         payment_provider NOT NULL,
  scope            text NOT NULL CHECK (scope IN ('platform', 'store')),
  store_id         uuid,                          -- FK added after stores
  event_type       text NOT NULL,
  idempotency_key  text NOT NULL,                 -- sha256 of raw body (Paystack sends no event id)
  signature_valid  boolean NOT NULL,
  payload          jsonb NOT NULL,
  status           webhook_status NOT NULL DEFAULT 'received',
  attempts         integer NOT NULL DEFAULT 0,
  error            text,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  UNIQUE (provider, scope, idempotency_key)
);

-- =============================================================================
-- STORES (the tenant)
-- =============================================================================
CREATE TABLE stores (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  name                    text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 80),
  -- 3-63 chars, lowercase letters/digits/hyphens, no leading/trailing hyphen
  subdomain               text NOT NULL UNIQUE
                          CHECK (subdomain ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'),
  billing_status          billing_status NOT NULL DEFAULT 'trialing',  -- denormalised from subscriptions
  trial_ends_at           timestamptz NOT NULL,
  admin_suspended_at      timestamptz,             -- super-admin suspension, independent of billing
  admin_suspended_reason  text,
  currency                char(3) NOT NULL DEFAULT 'NGN',
  timezone                text NOT NULL DEFAULT 'Africa/Lagos',
  contact_email           citext,
  contact_phone           text,
  address                 jsonb,
  seo                     jsonb NOT NULL DEFAULT '{}',   -- default title/description/OG image
  onboarding              jsonb NOT NULL DEFAULT '{}',   -- {"logo":false,"colours":false,"first_product":false}
  next_order_number       integer NOT NULL DEFAULT 1001, -- per-store human order numbers
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz
);

ALTER TABLE webhook_events
  ADD CONSTRAINT webhook_events_store_fk FOREIGN KEY (store_id) REFERENCES stores(id) ON DELETE SET NULL;

CREATE TABLE store_members (
  store_id    uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        store_member_role NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, user_id)
);
CREATE UNIQUE INDEX store_members_one_owner ON store_members (store_id) WHERE role = 'owner';
CREATE INDEX store_members_user_idx ON store_members (user_id);

CREATE TABLE store_invitations (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id     uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  email        citext NOT NULL,
  role         store_member_role NOT NULL CHECK (role <> 'owner'),
  token_hash   text NOT NULL UNIQUE,
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id)
);

-- Uploaded files (logos, favicons, product images, banners). Objects live in
-- R2/S3 under stores/<store_id>/...; this row is the source of truth.
CREATE TABLE media (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id      uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  storage_key   text NOT NULL UNIQUE,
  content_type  text NOT NULL CHECK (content_type IN ('image/jpeg','image/png','image/webp','image/avif','image/svg+xml','image/x-icon')),
  byte_size     integer NOT NULL CHECK (byte_size > 0),
  width         integer,
  height        integer,
  alt           text,
  uploaded_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id)
);

-- One theme per store; the storefront renders CSS variables from it.
CREATE TABLE store_themes (
  store_id          uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  primary_color     text NOT NULL DEFAULT '#16a34a' CHECK (primary_color    ~ '^#[0-9a-fA-F]{6}$'),
  secondary_color   text NOT NULL DEFAULT '#0f172a' CHECK (secondary_color  ~ '^#[0-9a-fA-F]{6}$'),
  accent_color      text NOT NULL DEFAULT '#f59e0b' CHECK (accent_color     ~ '^#[0-9a-fA-F]{6}$'),
  background_color  text NOT NULL DEFAULT '#ffffff' CHECK (background_color ~ '^#[0-9a-fA-F]{6}$'),
  text_color        text NOT NULL DEFAULT '#111827' CHECK (text_color       ~ '^#[0-9a-fA-F]{6}$'),
  font_heading      text NOT NULL DEFAULT 'inter',   -- key into a curated font list (next/font needs build-time fonts)
  font_body         text NOT NULL DEFAULT 'inter',
  logo_media_id     uuid,
  favicon_media_id  uuid,
  hero              jsonb NOT NULL DEFAULT '{}',     -- {"title","subtitle","cta_label","cta_href","image_media_id"}
  announcement      text,
  version           integer NOT NULL DEFAULT 1,      -- bumped on save; part of cache keys
  updated_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, logo_media_id)    REFERENCES media(store_id, id) ON DELETE SET NULL (logo_media_id),
  FOREIGN KEY (store_id, favicon_media_id) REFERENCES media(store_id, id) ON DELETE SET NULL (favicon_media_id)
);

CREATE TABLE shipping_methods (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id         uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  name             text NOT NULL,                 -- 'Lagos delivery', 'Store pickup'
  description      text,
  price_minor      bigint NOT NULL CHECK (price_minor >= 0),
  free_over_minor  bigint CHECK (free_over_minor IS NULL OR free_over_minor >= 0),
  regions          text[] NOT NULL DEFAULT '{}',  -- state codes; empty = everywhere
  min_days         smallint,
  max_days         smallint,
  is_active        boolean NOT NULL DEFAULT true,
  position         integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id)
);

-- =============================================================================
-- PLATFORM BILLING (tenant-scoped rows, written by platform code/webhooks)
-- =============================================================================
CREATE TABLE subscriptions (
  id                           uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id                     uuid NOT NULL UNIQUE REFERENCES stores(id) ON DELETE CASCADE,
  plan_id                      uuid NOT NULL REFERENCES plans(id),
  pending_plan_id              uuid REFERENCES plans(id),   -- scheduled downgrade at period end
  status                       billing_status NOT NULL DEFAULT 'trialing',
  trial_ends_at                timestamptz,
  current_period_start         timestamptz,
  current_period_end           timestamptz,
  grace_ends_at                timestamptz,                 -- set when entering past_due
  cancel_at_period_end         boolean NOT NULL DEFAULT false,
  auto_renew                   boolean NOT NULL DEFAULT false,
  paystack_customer_code       text,
  paystack_subscription_code   text,                        -- only if Paystack-managed subscriptions
  paystack_authorization_enc   bytea,                       -- encrypted reusable card authorization (self-managed renewals)
  version                      integer NOT NULL DEFAULT 0,  -- optimistic lock for state transitions
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id)
);

CREATE TABLE subscription_payments (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id            uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  subscription_id     uuid NOT NULL,
  plan_id             uuid NOT NULL REFERENCES plans(id),
  kind                text NOT NULL CHECK (kind IN ('new', 'renewal', 'upgrade')),
  amount_minor        bigint NOT NULL CHECK (amount_minor >= 0),
  currency            char(3) NOT NULL,
  status              payment_status NOT NULL DEFAULT 'pending',
  provider            payment_provider NOT NULL DEFAULT 'paystack',
  provider_reference  text NOT NULL,
  channel             text,                                 -- card, bank_transfer, ussd ...
  period_start        timestamptz,
  period_end          timestamptz,
  paid_at             timestamptz,
  failure_reason      text,
  raw                 jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_reference),
  FOREIGN KEY (store_id, subscription_id) REFERENCES subscriptions(store_id, id) ON DELETE CASCADE
);
CREATE INDEX subscription_payments_store_idx ON subscription_payments (store_id, created_at DESC);

-- =============================================================================
-- DOMAINS
-- =============================================================================
-- Registrant contact per store (the store owner should be the legal registrant).
CREATE TABLE domain_contacts (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id            uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  entity_type         text NOT NULL CHECK (entity_type IN ('individual', 'organization')),
  first_name          text NOT NULL,
  last_name           text NOT NULL,
  company             text,
  email               citext NOT NULL,
  phone               text NOT NULL,
  address_line1       text NOT NULL,
  address_line2       text,
  city                text NOT NULL,
  state               text,
  postal_code         text,
  country             char(2) NOT NULL DEFAULT 'NG',
  registrar_profiles  jsonb NOT NULL DEFAULT '{}',   -- {"hostinger":{"com":123,"ng":456}} WHOIS profile id per TLD
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id)
);

CREATE TABLE domains (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id             uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  hostname             text NOT NULL CHECK (hostname ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$'), -- punycode, lowercase
  kind                 domain_kind NOT NULL,
  status               domain_status NOT NULL,
  registrar            registrar_kind NOT NULL,
  registrar_ref        text,                         -- registrar-side id (e.g. Hostinger subscription id)
  is_primary           boolean NOT NULL DEFAULT false,
  include_www          boolean NOT NULL DEFAULT true, -- also serve www.<hostname> (redirects to primary)
  verification_token   text NOT NULL,                -- TXT value for _<platform>-verify.<hostname>
  verified_at          timestamptz,
  dns_last_checked_at  timestamptz,
  dns_check_attempts   integer NOT NULL DEFAULT 0,
  last_error           text,
  registered_at        timestamptz,
  expires_at           timestamptz,
  auto_renew           boolean NOT NULL DEFAULT true,
  ssl_ready_at         timestamptz,                  -- first successful HTTPS probe
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id)
);
-- A hostname can be claimed by only one store at a time (removed rows free it).
CREATE UNIQUE INDEX domains_hostname_live ON domains (hostname) WHERE status <> 'removed';
CREATE UNIQUE INDEX domains_one_primary   ON domains (store_id) WHERE is_primary;
CREATE INDEX domains_work_queue ON domains (status, dns_last_checked_at)
  WHERE status IN ('registering', 'dns_pending');

CREATE TABLE domain_orders (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id            uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  domain_id           uuid NOT NULL,
  contact_id          uuid,
  kind                domain_order_kind NOT NULL,
  hostname            text NOT NULL,
  years               smallint NOT NULL DEFAULT 1 CHECK (years BETWEEN 1 AND 10),
  registrar           registrar_kind NOT NULL,
  registrar_item_id   text,                 -- Hostinger catalog price item id used at purchase
  -- Quote snapshot (what it cost us, and what we charged)
  cost_minor          bigint,               -- registrar price in its currency's minor unit (Hostinger: cents)
  cost_currency       char(3),
  renewal_cost_minor  bigint,               -- registrars often renew at a higher price; shown to owner
  fx_rate             numeric(14, 4),
  markup_percent      numeric(6, 2),
  markup_fixed_minor  bigint,
  price_minor         bigint NOT NULL CHECK (price_minor >= 0),
  currency            char(3) NOT NULL DEFAULT 'NGN',
  quote_expires_at    timestamptz NOT NULL,
  -- Payment + fulfilment
  status              domain_order_status NOT NULL DEFAULT 'pending_payment',
  payment_reference   text UNIQUE,
  paid_at             timestamptz,
  registrar_order_ref text,
  attempts            integer NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz,
  last_error          text,
  completed_at        timestamptz,
  refunded_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, domain_id)  REFERENCES domains(store_id, id) ON DELETE CASCADE,
  FOREIGN KEY (store_id, contact_id) REFERENCES domain_contacts(store_id, id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX domain_orders_queue ON domain_orders (status, next_attempt_at)
  WHERE status IN ('paid', 'registering', 'failed', 'manual_required');

-- Append-only timeline per domain order (drives the super-admin failures queue).
CREATE TABLE domain_order_events (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id         uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  domain_order_id  uuid NOT NULL,
  from_status      domain_order_status,
  to_status        domain_order_status NOT NULL,
  message          text,
  data             jsonb,                    -- sanitised registrar request/response
  actor_user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, domain_order_id) REFERENCES domain_orders(store_id, id) ON DELETE CASCADE
);

-- =============================================================================
-- CATALOG
-- =============================================================================
CREATE TABLE categories (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id        uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  parent_id       uuid,
  name            text NOT NULL,
  slug            text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description     text,
  image_media_id  uuid,
  position        integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  UNIQUE (store_id, slug),
  CHECK (parent_id IS NULL OR parent_id <> id),
  FOREIGN KEY (store_id, parent_id)      REFERENCES categories(store_id, id) ON DELETE SET NULL (parent_id),
  FOREIGN KEY (store_id, image_media_id) REFERENCES media(store_id, id)      ON DELETE SET NULL (image_media_id)
);

CREATE TABLE products (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id         uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  title            text NOT NULL,
  slug             text NOT NULL CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description      text,                       -- sanitised rich text
  status           product_status NOT NULL DEFAULT 'draft',
  options          jsonb NOT NULL DEFAULT '[]', -- [{"name":"Size","values":["S","M"]},{"name":"Colour","values":["Red"]}]
  is_featured      boolean NOT NULL DEFAULT false,
  seo_title        text,
  seo_description  text,
  published_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz,                -- soft delete keeps order history intact
  UNIQUE (store_id, id)
);
CREATE UNIQUE INDEX products_store_slug ON products (store_id, slug) WHERE deleted_at IS NULL;
CREATE INDEX products_listing ON products (store_id, status, created_at DESC) WHERE deleted_at IS NULL;
-- Storefront search (Postgres FTS; swap for Meilisearch later if needed)
CREATE INDEX products_search ON products
  USING gin (to_tsvector('simple', title || ' ' || coalesce(description, '')));

CREATE TABLE product_categories (
  store_id     uuid NOT NULL,
  product_id   uuid NOT NULL,
  category_id  uuid NOT NULL,
  position     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (store_id, product_id, category_id),
  FOREIGN KEY (store_id, product_id)  REFERENCES products(store_id, id)   ON DELETE CASCADE,
  FOREIGN KEY (store_id, category_id) REFERENCES categories(store_id, id) ON DELETE CASCADE
);
CREATE INDEX product_categories_category ON product_categories (store_id, category_id, position);

-- Every product has at least one variant ("Default"), so price/stock live in one place.
CREATE TABLE product_variants (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id                uuid NOT NULL,
  product_id              uuid NOT NULL,
  title                   text NOT NULL DEFAULT 'Default',   -- 'M / Red'
  sku                     text,
  option_values           jsonb NOT NULL DEFAULT '{}',       -- {"Size":"M","Colour":"Red"}
  price_minor             bigint NOT NULL CHECK (price_minor >= 0),
  compare_at_price_minor  bigint CHECK (compare_at_price_minor IS NULL OR compare_at_price_minor >= 0),
  stock_quantity          integer NOT NULL DEFAULT 0,
  track_inventory         boolean NOT NULL DEFAULT true,
  allow_backorder         boolean NOT NULL DEFAULT false,
  weight_grams            integer CHECK (weight_grams IS NULL OR weight_grams >= 0),
  position                integer NOT NULL DEFAULT 0,
  is_default              boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  UNIQUE (store_id, id),
  CHECK (stock_quantity >= 0 OR allow_backorder OR NOT track_inventory),
  FOREIGN KEY (store_id, product_id) REFERENCES products(store_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX product_variants_sku     ON product_variants (store_id, sku) WHERE sku IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX product_variants_options ON product_variants (product_id, option_values) WHERE deleted_at IS NULL;
CREATE INDEX product_variants_product ON product_variants (store_id, product_id, position);

CREATE TABLE product_images (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id    uuid NOT NULL,
  product_id  uuid NOT NULL,
  media_id    uuid NOT NULL,
  variant_id  uuid,                 -- optional: image shown when this variant is selected
  alt         text,
  position    integer NOT NULL DEFAULT 0,
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, product_id) REFERENCES products(store_id, id)         ON DELETE CASCADE,
  FOREIGN KEY (store_id, media_id)   REFERENCES media(store_id, id)            ON DELETE CASCADE,
  FOREIGN KEY (store_id, variant_id) REFERENCES product_variants(store_id, id) ON DELETE SET NULL (variant_id)
);
CREATE INDEX product_images_product ON product_images (store_id, product_id, position);

-- =============================================================================
-- CUSTOMERS (accounts are per store: same email on two stores = two customers)
-- =============================================================================
CREATE TABLE customers (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id           uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  email              citext NOT NULL,
  name               text,
  phone              text,
  password_hash      text,                -- NULL = guest checkout customer
  email_verified_at  timestamptz,
  accepts_marketing  boolean NOT NULL DEFAULT false,
  last_login_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  UNIQUE (store_id, email)
);

CREATE TABLE customer_sessions (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id     uuid NOT NULL,
  customer_id  uuid NOT NULL,
  token_hash   text NOT NULL UNIQUE,     -- cookie holds the raw token; host-only cookie per store host
  expires_at   timestamptz NOT NULL,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, id) ON DELETE CASCADE
);

CREATE TABLE customer_tokens (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id     uuid NOT NULL,
  customer_id  uuid NOT NULL,
  purpose      text NOT NULL CHECK (purpose IN ('verify_email', 'reset_password')),
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, id) ON DELETE CASCADE
);

CREATE TABLE customer_addresses (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id     uuid NOT NULL,
  customer_id  uuid NOT NULL,
  full_name    text NOT NULL,
  phone        text NOT NULL,
  line1        text NOT NULL,
  line2        text,
  city         text NOT NULL,
  state        text NOT NULL,
  postal_code  text,
  country      char(2) NOT NULL DEFAULT 'NG',
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, id) ON DELETE CASCADE
);

-- =============================================================================
-- CART & ORDERS
-- =============================================================================
CREATE TABLE carts (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id     uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  customer_id  uuid,
  token_hash   text NOT NULL UNIQUE,     -- anonymous cart cookie
  status       cart_status NOT NULL DEFAULT 'active',
  email        citext,
  currency     char(3) NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  FOREIGN KEY (store_id, customer_id) REFERENCES customers(store_id, id) ON DELETE SET NULL (customer_id)
);

CREATE TABLE cart_items (
  id          uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id    uuid NOT NULL,
  cart_id     uuid NOT NULL,
  variant_id  uuid NOT NULL,
  quantity    integer NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  added_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cart_id, variant_id),
  FOREIGN KEY (store_id, cart_id)    REFERENCES carts(store_id, id)            ON DELETE CASCADE,
  FOREIGN KEY (store_id, variant_id) REFERENCES product_variants(store_id, id) ON DELETE CASCADE
);

CREATE TABLE orders (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id              uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  order_number          integer NOT NULL,              -- from stores.next_order_number
  customer_id           uuid,
  cart_id               uuid,
  email                 citext NOT NULL,
  phone                 text,
  status                order_status NOT NULL DEFAULT 'pending',
  currency              char(3) NOT NULL,
  subtotal_minor        bigint NOT NULL CHECK (subtotal_minor >= 0),
  shipping_minor        bigint NOT NULL DEFAULT 0 CHECK (shipping_minor >= 0),
  discount_minor        bigint NOT NULL DEFAULT 0 CHECK (discount_minor >= 0),
  tax_minor             bigint NOT NULL DEFAULT 0 CHECK (tax_minor >= 0),
  total_minor           bigint NOT NULL CHECK (total_minor >= 0),
  shipping_method_id    uuid,
  shipping_method_name  text,                          -- snapshot
  shipping_address      jsonb NOT NULL,                -- snapshot
  billing_address       jsonb,
  customer_note         text,
  internal_note         text,
  payment_provider      payment_provider,
  payment_reference     text,
  inventory_committed   boolean NOT NULL DEFAULT false, -- stock decremented exactly once
  paid_at               timestamptz,
  shipped_at            timestamptz,
  delivered_at          timestamptz,
  cancelled_at          timestamptz,
  cancel_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, id),
  UNIQUE (store_id, order_number),
  CHECK (total_minor = subtotal_minor + shipping_minor + tax_minor - discount_minor),
  FOREIGN KEY (store_id, customer_id)        REFERENCES customers(store_id, id)        ON DELETE SET NULL (customer_id),
  FOREIGN KEY (store_id, cart_id)            REFERENCES carts(store_id, id)            ON DELETE SET NULL (cart_id),
  FOREIGN KEY (store_id, shipping_method_id) REFERENCES shipping_methods(store_id, id) ON DELETE SET NULL (shipping_method_id)
);
CREATE UNIQUE INDEX orders_payment_ref ON orders (payment_provider, payment_reference) WHERE payment_reference IS NOT NULL;
CREATE INDEX orders_listing  ON orders (store_id, status, created_at DESC);
CREATE INDEX orders_customer ON orders (store_id, customer_id, created_at DESC);

CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id          uuid NOT NULL,
  order_id          uuid NOT NULL,
  product_id        uuid,
  variant_id        uuid,
  product_title     text NOT NULL,     -- snapshots: order history survives product edits/deletes
  variant_title     text,
  sku               text,
  image_url         text,
  unit_price_minor  bigint NOT NULL CHECK (unit_price_minor >= 0),
  quantity          integer NOT NULL CHECK (quantity > 0),
  line_total_minor  bigint NOT NULL,
  CHECK (line_total_minor = unit_price_minor * quantity),
  FOREIGN KEY (store_id, order_id)   REFERENCES orders(store_id, id)           ON DELETE CASCADE,
  FOREIGN KEY (store_id, product_id) REFERENCES products(store_id, id)         ON DELETE SET NULL (product_id),
  FOREIGN KEY (store_id, variant_id) REFERENCES product_variants(store_id, id) ON DELETE SET NULL (variant_id)
);
CREATE INDEX order_items_order ON order_items (store_id, order_id);

CREATE TABLE order_status_history (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id     uuid NOT NULL,
  order_id     uuid NOT NULL,
  from_status  order_status,
  to_status    order_status NOT NULL,
  note         text,
  actor_type   actor_type NOT NULL,
  actor_id     uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE CASCADE
);

-- =============================================================================
-- STORE PAYMENTS (customer money -> store owner's own Paystack account)
-- =============================================================================
CREATE TABLE payment_provider_credentials (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id          uuid NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  provider          payment_provider NOT NULL,
  mode              provider_mode NOT NULL,
  public_key        text NOT NULL,
  secret_key_enc    bytea NOT NULL,      -- AES-256-GCM: iv || auth tag || ciphertext
  enc_key_version   smallint NOT NULL,   -- which master key (env) encrypted it; enables rotation
  secret_key_last4  text NOT NULL,       -- for display only
  is_active         boolean NOT NULL DEFAULT false,
  verified_at       timestamptz,         -- keys tested against provider API
  last_webhook_at   timestamptz,         -- tells the owner whether their webhook URL is set up
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, provider, mode)
);

CREATE TABLE store_payments (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id            uuid NOT NULL,
  order_id            uuid NOT NULL,
  provider            payment_provider NOT NULL,
  mode                provider_mode NOT NULL,
  reference           text NOT NULL,       -- generated by us, sent to provider
  amount_minor        bigint NOT NULL CHECK (amount_minor >= 0),
  currency            char(3) NOT NULL,
  status              payment_status NOT NULL DEFAULT 'pending',
  channel             text,
  provider_fee_minor  bigint,
  paid_at             timestamptz,
  raw                 jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, reference),
  FOREIGN KEY (store_id, order_id) REFERENCES orders(store_id, id) ON DELETE CASCADE
);
CREATE INDEX store_payments_pending ON store_payments (status, created_at) WHERE status = 'pending';

-- =============================================================================
-- OPS: audit log + notifications
-- =============================================================================
CREATE TABLE audit_logs (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id              uuid REFERENCES stores(id) ON DELETE SET NULL,   -- NULL = platform-level action
  actor_type            actor_type NOT NULL,
  actor_user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  impersonator_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  action                text NOT NULL,          -- 'product.update', 'store.suspend', 'domain.mark_registered'
  entity_type           text,
  entity_id             text,
  changes               jsonb,                  -- {"field": [old, new]}, secrets redacted
  ip_address            inet,
  user_agent            text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_store ON audit_logs (store_id, created_at DESC);
CREATE INDEX audit_logs_actor ON audit_logs (actor_user_id, created_at DESC);

CREATE TABLE notifications (
  id             uuid PRIMARY KEY DEFAULT uuidv7(),
  store_id       uuid REFERENCES stores(id) ON DELETE CASCADE,
  user_id        uuid REFERENCES users(id) ON DELETE CASCADE,
  customer_id    uuid,
  channel        notification_channel NOT NULL,
  template       text NOT NULL,           -- 'trial_ending', 'payment_failed', 'domain_active' ...
  to_address     citext,
  dedupe_key     text UNIQUE,             -- e.g. 'trial_ending:7d:<store_id>:<trial_ends_at date>'
  payload        jsonb NOT NULL DEFAULT '{}',
  status         notification_status NOT NULL DEFAULT 'queued',
  attempts       integer NOT NULL DEFAULT 0,
  error          text,
  scheduled_for  timestamptz NOT NULL DEFAULT now(),
  sent_at        timestamptz,
  read_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_due  ON notifications (status, scheduled_for) WHERE status = 'queued';
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC) WHERE channel = 'in_app';

-- (Background jobs use pg-boss, which creates its own "pgboss" schema.)

-- =============================================================================
-- updated_at triggers
-- =============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','auth_accounts','auth_sessions','plans','stores','shipping_methods','store_themes',
    'subscriptions','subscription_payments','domain_contacts','domains','domain_orders',
    'categories','products','product_variants','customers','carts','orders',
    'payment_provider_credentials','store_payments'
  ] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
                   t || '_set_updated_at', t);
  END LOOP;
END $$;

-- =============================================================================
-- ROLES & ROW-LEVEL SECURITY
-- =============================================================================
-- Three roles (passwords set by ops, never in migrations):
--   app_owner    owns the schema, runs migrations
--   app_tenant   used for ALL tenant-scoped queries; RLS enforced
--   app_platform BYPASSRLS; only tenancy resolution, auth, signup, webhooks,
--                super-admin and the worker may import this pool (lint-enforced)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_tenant')   THEN CREATE ROLE app_tenant   NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN CREATE ROLE app_platform NOLOGIN BYPASSRLS; END IF;
END $$;

-- The stores table itself: a tenant sees only its own row.
ALTER TABLE stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE stores FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON stores
  USING (id = current_store_id()) WITH CHECK (id = current_store_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'store_members','store_invitations','media','store_themes','shipping_methods',
    'subscriptions','subscription_payments',
    'domain_contacts','domains','domain_orders','domain_order_events',
    'categories','products','product_categories','product_variants','product_images',
    'customers','customer_sessions','customer_tokens','customer_addresses',
    'carts','cart_items','orders','order_items','order_status_history',
    'payment_provider_credentials','store_payments','audit_logs','notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_tenant', t);
  END LOOP;
END $$;

GRANT USAGE ON SCHEMA public TO app_tenant, app_platform;
GRANT SELECT, UPDATE ON stores TO app_tenant;                 -- tenant can edit its own settings row
GRANT SELECT ON plans TO app_tenant;                          -- billing page lists plans
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_platform;
GRANT EXECUTE ON FUNCTION current_store_id() TO app_tenant, app_platform;

-- Audit log is append-only for everyone.
REVOKE UPDATE, DELETE ON audit_logs FROM app_tenant, app_platform;
-- The tenant role may write keys (owner saves them) but can never read the ciphertext back.
-- Only the payments module decrypts, via the platform pool, at charge/verify time.
REVOKE SELECT ON payment_provider_credentials FROM app_tenant;
GRANT SELECT (id, store_id, provider, mode, public_key, secret_key_last4, is_active, verified_at, last_webhook_at, created_at, updated_at)
  ON payment_provider_credentials TO app_tenant;
