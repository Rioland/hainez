-- Composite (store_id, x_id) foreign keys whose child column is nullable.
-- On delete of the parent only the child column is cleared; store_id is kept
-- (Postgres 15+ "ON DELETE SET NULL (column)"). Drizzle can't express the
-- column list, so these live here instead of in the schema files.

ALTER TABLE categories
  ADD CONSTRAINT categories_parent_fk FOREIGN KEY (store_id, parent_id)
  REFERENCES categories (store_id, id) ON DELETE SET NULL (parent_id);
--> statement-breakpoint
ALTER TABLE categories
  ADD CONSTRAINT categories_image_fk FOREIGN KEY (store_id, image_media_id)
  REFERENCES media (store_id, id) ON DELETE SET NULL (image_media_id);
--> statement-breakpoint
ALTER TABLE product_images
  ADD CONSTRAINT product_images_variant_fk FOREIGN KEY (store_id, variant_id)
  REFERENCES product_variants (store_id, id) ON DELETE SET NULL (variant_id);
--> statement-breakpoint
ALTER TABLE orders
  ADD CONSTRAINT orders_customer_fk FOREIGN KEY (store_id, customer_id)
  REFERENCES customers (store_id, id) ON DELETE SET NULL (customer_id);
--> statement-breakpoint
ALTER TABLE orders
  ADD CONSTRAINT orders_shipping_method_fk FOREIGN KEY (store_id, shipping_method_id)
  REFERENCES shipping_methods (store_id, id) ON DELETE SET NULL (shipping_method_id);
--> statement-breakpoint
ALTER TABLE order_items
  ADD CONSTRAINT order_items_product_fk FOREIGN KEY (store_id, product_id)
  REFERENCES products (store_id, id) ON DELETE SET NULL (product_id);
--> statement-breakpoint
ALTER TABLE order_items
  ADD CONSTRAINT order_items_variant_fk FOREIGN KEY (store_id, variant_id)
  REFERENCES product_variants (store_id, id) ON DELETE SET NULL (variant_id);
--> statement-breakpoint

-- Audit log is append-only for EVERY role, including the owner connection.
-- The only permitted change is Postgres clearing a reference when the store or
-- user it points to is hard-deleted (ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  IF (NEW.id, NEW.actor_type, NEW.action, NEW.entity_type, NEW.entity_id, NEW.changes,
      NEW.ip_address, NEW.user_agent, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.actor_type, OLD.action, OLD.entity_type, OLD.entity_id, OLD.changes,
      OLD.ip_address, OLD.user_agent, OLD.created_at)
     OR (NEW.store_id IS DISTINCT FROM OLD.store_id AND NEW.store_id IS NOT NULL)
     OR (NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id AND NEW.actor_user_id IS NOT NULL)
     OR (NEW.impersonator_user_id IS DISTINCT FROM OLD.impersonator_user_id AND NEW.impersonator_user_id IS NOT NULL)
  THEN
    RAISE EXCEPTION 'audit_logs is append-only';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER audit_logs_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
