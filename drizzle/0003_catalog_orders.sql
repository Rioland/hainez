CREATE TYPE "public"."actor_type" AS ENUM('user', 'super_admin', 'customer', 'system');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'paid', 'shipped', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer,
	"height" integer,
	"alt" text,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "media_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "media_store_id_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "media_content_type_check" CHECK ("media"."content_type" IN ('image/jpeg','image/png','image/webp','image/avif','image/gif')),
	CONSTRAINT "media_byte_size_check" CHECK ("media"."byte_size" > 0)
);
--> statement-breakpoint
ALTER TABLE "media" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"image_media_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_store_id_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "categories_store_slug_key" UNIQUE("store_id","slug"),
	CONSTRAINT "categories_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "categories_not_own_parent" CHECK ("categories"."parent_id" IS NULL OR "categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_categories" (
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_categories_store_id_product_id_category_id_pk" PRIMARY KEY("store_id","product_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "product_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"variant_id" uuid,
	"alt" text,
	"position" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "product_images_store_id_id_key" UNIQUE("store_id","id")
);
--> statement-breakpoint
ALTER TABLE "product_images" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"title" text DEFAULT 'Default' NOT NULL,
	"sku" text,
	"option_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price_minor" bigint NOT NULL,
	"compare_at_price_minor" bigint,
	"stock_quantity" integer DEFAULT 0 NOT NULL,
	"track_inventory" boolean DEFAULT true NOT NULL,
	"allow_backorder" boolean DEFAULT false NOT NULL,
	"weight_grams" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "product_variants_store_id_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "product_variants_price_check" CHECK ("product_variants"."price_minor" >= 0),
	CONSTRAINT "product_variants_compare_at_check" CHECK ("product_variants"."compare_at_price_minor" IS NULL OR "product_variants"."compare_at_price_minor" >= 0),
	CONSTRAINT "product_variants_stock_check" CHECK ("product_variants"."stock_quantity" >= 0 OR "product_variants"."allow_backorder" OR NOT "product_variants"."track_inventory")
);
--> statement-breakpoint
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"status" "product_status" DEFAULT 'draft' NOT NULL,
	"options" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"seo_title" text,
	"seo_description" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "products_store_id_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "products_slug_check" CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "products_title_check" CHECK (char_length("products"."title") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"email" "citext" NOT NULL,
	"name" text,
	"phone" text,
	"password_hash" text,
	"email_verified_at" timestamp with time zone,
	"accepts_marketing" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_store_id_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "customers_store_email_key" UNIQUE("store_id","email")
);
--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"product_title" text NOT NULL,
	"variant_title" text,
	"sku" text,
	"image_url" text,
	"unit_price_minor" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_minor" bigint NOT NULL,
	CONSTRAINT "order_items_store_id_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "order_items_quantity_check" CHECK ("order_items"."quantity" > 0),
	CONSTRAINT "order_items_price_check" CHECK ("order_items"."unit_price_minor" >= 0),
	CONSTRAINT "order_items_total_check" CHECK ("order_items"."line_total_minor" = "order_items"."unit_price_minor" * "order_items"."quantity")
);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"note" text,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_status_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"order_number" integer NOT NULL,
	"customer_id" uuid,
	"email" "citext" NOT NULL,
	"phone" text,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"currency" char(3) NOT NULL,
	"subtotal_minor" bigint NOT NULL,
	"shipping_minor" bigint DEFAULT 0 NOT NULL,
	"discount_minor" bigint DEFAULT 0 NOT NULL,
	"tax_minor" bigint DEFAULT 0 NOT NULL,
	"total_minor" bigint NOT NULL,
	"shipping_method_id" uuid,
	"shipping_method_name" text,
	"shipping_address" jsonb NOT NULL,
	"billing_address" jsonb,
	"customer_note" text,
	"internal_note" text,
	"payment_provider" text,
	"payment_reference" text,
	"inventory_committed" boolean DEFAULT false NOT NULL,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"tracking_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_store_id_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "orders_store_number_key" UNIQUE("store_id","order_number"),
	CONSTRAINT "orders_total_check" CHECK ("orders"."total_minor" = "orders"."subtotal_minor" + "orders"."shipping_minor" + "orders"."tax_minor" - "orders"."discount_minor"),
	CONSTRAINT "orders_amounts_check" CHECK ("orders"."subtotal_minor" >= 0 AND "orders"."shipping_minor" >= 0 AND "orders"."discount_minor" >= 0 AND "orders"."tax_minor" >= 0 AND "orders"."total_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shipping_methods" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"price_minor" bigint NOT NULL,
	"free_over_minor" bigint,
	"regions" text[] DEFAULT '{}'::text[] NOT NULL,
	"min_days" smallint,
	"max_days" smallint,
	"is_active" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipping_methods_store_id_id_key" UNIQUE("store_id","id"),
	CONSTRAINT "shipping_methods_price_check" CHECK ("shipping_methods"."price_minor" >= 0),
	CONSTRAINT "shipping_methods_free_over_check" CHECK ("shipping_methods"."free_over_minor" IS NULL OR "shipping_methods"."free_over_minor" >= 0),
	CONSTRAINT "shipping_methods_days_check" CHECK ("shipping_methods"."min_days" IS NULL OR "shipping_methods"."max_days" IS NULL OR "shipping_methods"."min_days" <= "shipping_methods"."max_days")
);
--> statement-breakpoint
ALTER TABLE "shipping_methods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_generate_v7() NOT NULL,
	"store_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"actor_user_id" uuid,
	"impersonator_user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"changes" jsonb,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_store_id_category_id_categories_store_id_id_fk" FOREIGN KEY ("store_id","category_id") REFERENCES "public"."categories"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_store_id_media_id_media_store_id_id_fk" FOREIGN KEY ("store_id","media_id") REFERENCES "public"."media"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_store_id_order_id_orders_store_id_id_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "public"."orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_status_history" ADD CONSTRAINT "order_status_history_store_id_order_id_orders_store_id_id_fk" FOREIGN KEY ("store_id","order_id") REFERENCES "public"."orders"("store_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipping_methods" ADD CONSTRAINT "shipping_methods_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_impersonator_user_id_users_id_fk" FOREIGN KEY ("impersonator_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_store_idx" ON "media" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "product_categories_category" ON "product_categories" USING btree ("store_id","category_id","position");--> statement-breakpoint
CREATE INDEX "product_images_product" ON "product_images" USING btree ("store_id","product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_sku" ON "product_variants" USING btree ("store_id","sku") WHERE sku IS NOT NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "product_variants_options" ON "product_variants" USING btree ("product_id","option_values") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "product_variants_product" ON "product_variants" USING btree ("store_id","product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "products_store_slug" ON "products" USING btree ("store_id","slug") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "products_listing" ON "products" USING btree ("store_id","status","created_at" DESC NULLS LAST) WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "products_search" ON "products" USING gin (to_tsvector('simple', "title" || ' ' || coalesce("description", '')));--> statement-breakpoint
CREATE INDEX "order_items_order" ON "order_items" USING btree ("store_id","order_id");--> statement-breakpoint
CREATE INDEX "order_items_product" ON "order_items" USING btree ("store_id","product_id");--> statement-breakpoint
CREATE INDEX "order_status_history_order" ON "order_status_history" USING btree ("store_id","order_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_listing" ON "orders" USING btree ("store_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_customer" ON "orders" USING btree ("store_id","customer_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "orders_created" ON "orders" USING btree ("store_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_store" ON "audit_logs" USING btree ("store_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor" ON "audit_logs" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "media" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "categories" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_categories" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_images" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "product_variants" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "products" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customers" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_items" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "order_status_history" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "orders" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shipping_methods" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_logs" AS PERMISSIVE FOR ALL TO "app_tenant" USING (store_id = current_store_id()) WITH CHECK (store_id = current_store_id());