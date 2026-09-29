-- Column-level grants on the tenant root table. A store (running as app_tenant)
-- can read its own row and edit its own settings, but can never change its
-- subdomain, billing state, trial dates or admin suspension; only platform code can.
GRANT SELECT ON public.stores TO app_tenant;
--> statement-breakpoint
GRANT UPDATE (name, currency, timezone, contact_email, contact_phone, address, seo, onboarding, next_order_number, updated_at)
  ON public.stores TO app_tenant;
