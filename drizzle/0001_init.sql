CREATE TYPE "public"."billing_status" AS ENUM('trialing', 'active', 'past_due', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."domain_kind" AS ENUM('purchased', 'external');--> statement-breakpoint
CREATE TYPE "public"."domain_status" AS ENUM('pending_payment', 'registering', 'dns_pending', 'active', 'failed', 'expired', 'removed');--> statement-breakpoint
CREATE TYPE "public"."platform_role" AS ENUM('user', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."registrar_kind" AS ENUM('hostinger', 'manual', 'external');--> statement-breakpoint
CREATE TYPE "public"."store_member_role" AS ENUM('owner', 'admin', 'staff');--> statement-breakpoint
CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"account_id" text NOT NULL,
	"password" text,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"impersonated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"email" "citext" NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"platform_role" "platform_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reserved_subdomains" (
	"name" text PRIMARY KEY NOT NULL,
	"reason" text,
	CONSTRAINT "reserved_subdomains_name_check" CHECK ("reserved_subdomains"."name" ~ '^[a-z0-9-]+$')
);
--> statement-breakpoint
CREATE TABLE "store_members" (
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "store_member_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_members_store_id_user_id_pk" PRIMARY KEY("store_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "store_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"billing_status" "billing_status" DEFAULT 'trialing' NOT NULL,
	"trial_ends_at" timestamp with time zone NOT NULL,
	"admin_suspended_at" timestamp with time zone,
	"admin_suspended_reason" text,
	"currency" char(3) DEFAULT 'NGN' NOT NULL,
	"timezone" text DEFAULT 'Africa/Lagos' NOT NULL,
	"contact_email" "citext",
	"contact_phone" text,
	"address" jsonb,
	"seo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"onboarding" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"next_order_number" integer DEFAULT 1001 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "stores_subdomain_unique" UNIQUE("subdomain"),
	CONSTRAINT "stores_name_check" CHECK (char_length("stores"."name") BETWEEN 2 AND 80),
	CONSTRAINT "stores_subdomain_check" CHECK ("stores"."subdomain" ~ '^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$')
);
--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "domains" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"kind" "domain_kind" NOT NULL,
	"status" "domain_status" NOT NULL,
	"registrar" "registrar_kind" NOT NULL,
	"registrar_ref" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"include_www" boolean DEFAULT true NOT NULL,
	"verification_token" text NOT NULL,
	"verified_at" timestamp with time zone,
	"dns_last_checked_at" timestamp with time zone,
	"dns_check_attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"registered_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"auto_renew" boolean DEFAULT true NOT NULL,
	"ssl_ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "domains_store_id_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "domains_hostname_check" CHECK ("domains"."hostname" ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$')
);
--> statement-breakpoint
ALTER TABLE "domains" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_impersonated_by_users_id_fk" FOREIGN KEY ("impersonated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_settings" ADD CONSTRAINT "platform_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_members" ADD CONSTRAINT "store_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domains" ADD CONSTRAINT "domains_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "store_members_one_owner" ON "store_members" USING btree ("store_id") WHERE role = 'owner';--> statement-breakpoint
CREATE INDEX "store_members_user_idx" ON "store_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "domains_hostname_live" ON "domains" USING btree ("hostname") WHERE status <> 'removed';--> statement-breakpoint
CREATE UNIQUE INDEX "domains_one_primary" ON "domains" USING btree ("store_id") WHERE is_primary;--> statement-breakpoint
CREATE INDEX "domains_work_queue" ON "domains" USING btree ("status","dns_last_checked_at") WHERE status IN ('registering', 'dns_pending');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_members" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "stores" AS PERMISSIVE FOR ALL TO "app_tenant" USING (id = current_store_id()) WITH CHECK (id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "domains" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());