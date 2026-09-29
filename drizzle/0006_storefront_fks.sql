-- Composite (store_id, x_id) foreign keys for Stage 3 tables (see 0004 for why
-- these live in SQL). A cart line can only point at a variant of the SAME store.
ALTER TABLE cart_items
  ADD CONSTRAINT cart_items_variant_fk FOREIGN KEY (store_id, variant_id)
  REFERENCES product_variants (store_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE carts
  ADD CONSTRAINT carts_customer_fk FOREIGN KEY (store_id, customer_id)
  REFERENCES customers (store_id, id) ON DELETE SET NULL (customer_id);
