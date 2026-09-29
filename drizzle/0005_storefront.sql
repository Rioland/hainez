CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cart_items_cart_variant_key" UNIQUE("cart_id","variant_id"),
	CONSTRAINT "cart_items_quantity_check" CHECK ("cart_items"."quantity" BETWEEN 1 AND 999)
);
--> statement-breakpoint
ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carts_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "carts_store_id_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "carts_status_check" CHECK ("carts"."status" IN ('active', 'converted', 'abandoned'))
);
--> statement-breakpoint
ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "customer_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "account_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" text DEFAULT 'pay_on_delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "placed_signed_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_store_id_cart_id_carts_store_id_id_fk" FOREIGN KEY ("store_id","cart_id") REFERENCES "public"."carts"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_store_id_customer_id_customers_store_id_id_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "public"."customers"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "carts_customer" ON "carts" USING btree ("store_id","customer_id");--> statement-breakpoint
CREATE INDEX "customer_sessions_customer" ON "customer_sessions" USING btree ("store_id","customer_id");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_method_check" CHECK ("orders"."payment_method" IN ('pay_on_delivery', 'bank_transfer', 'online'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cart_items" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "carts" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_sessions" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());