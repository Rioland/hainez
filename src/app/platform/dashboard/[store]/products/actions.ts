"use server";

import { refresh } from "next/cache";
import { withTenant } from "@/server/db/tenant";
import { catalogChanged } from "@/server/modules/catalog/cache";
import { deleteProduct, saveProduct, setProductStatus } from "@/server/modules/catalog/products";
import { confirmImageUpload, prepareImageUpload } from "@/server/modules/media/uploads";
import { runStoreAction, type ActionState } from "@/server/modules/_shared/action";
import { DomainError } from "@/server/modules/_shared/errors";

/*
 * Product server actions. Each one re-checks the user's membership of THIS
 * store (runStoreAction) and runs inside withTenant(), whatever the client sends.
 */

function parsePayload(formData: FormData): unknown {
  try {
    return JSON.parse(String(formData.get("payload") ?? ""));
  } catch {
    throw new DomainError("The form data was invalid. Please reload and try again.");
  }
}

export async function saveProductAction(
  subdomain: string,
  productId: string | null,
  _prev: ActionState<{ id: string }>,
  formData: FormData,
): Promise<ActionState<{ id: string }>> {
  const result = await runStoreAction(subdomain, { min: "staff" }, async ({ actor }) => {
    const saved = await withTenant(actor.storeId, (tx) => saveProduct(tx, actor, productId, parsePayload(formData) as never));
    catalogChanged(actor.storeId);
    return { id: saved.id };
  });
  // Navigate (rather than just refresh) so the editor remounts with fresh data,
  // including ids of newly created variants.
  if (result?.ok && result.data) {
    return { ...result, redirectTo: `/dashboard/${subdomain}/products/${result.data.id}?${productId ? "saved" : "created"}=1` };
  }
  return result;
}

export async function deleteProductAction(subdomain: string, productId: string): Promise<ActionState> {
  const result = await runStoreAction(subdomain, { min: "staff" }, async ({ actor }) => {
    await withTenant(actor.storeId, (tx) => deleteProduct(tx, actor, productId));
    catalogChanged(actor.storeId);
  });
  if (result?.ok) return { ok: true, redirectTo: `/dashboard/${subdomain}/products?deleted=1` };
  return result as ActionState;
}

export async function setProductStatusAction(
  subdomain: string,
  productId: string,
  status: "draft" | "active" | "archived",
): Promise<ActionState> {
  const result = await runStoreAction(subdomain, { min: "staff" }, async ({ actor }) => {
    await withTenant(actor.storeId, (tx) => setProductStatus(tx, actor, productId, status));
    catalogChanged(actor.storeId);
  });
  if (result?.ok) refresh();
  return result as ActionState;
}

/** Step 1 of an image upload: get a signed URL to PUT the file to. */
export async function requestImageUploadAction(subdomain: string, input: { contentType: string; size: number }) {
  return runStoreAction(subdomain, { min: "staff" }, async ({ actor }) =>
    prepareImageUpload(actor.storeId, input as { contentType: never; size: number }),
  );
}

/** Step 2: verify the uploaded file and record it. */
export async function confirmImageUploadAction(subdomain: string, input: { key: string; alt?: string }) {
  return runStoreAction(subdomain, { min: "staff" }, async ({ actor }) =>
    withTenant(actor.storeId, (tx) => confirmImageUpload(tx, actor, input)),
  );
}
