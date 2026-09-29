"use server";

import { refresh } from "next/cache";
import { withTenant } from "@/server/db/tenant";
import { catalogChanged } from "@/server/modules/catalog/cache";
import { createCategory, deleteCategory, updateCategory } from "@/server/modules/catalog/categories";
import { runStoreAction, type ActionState } from "@/server/modules/_shared/action";

function readForm(formData: FormData) {
  return {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    parentId: String(formData.get("parentId") ?? "") || null,
    position: Number(formData.get("position") ?? 0),
    isActive: formData.get("isActive") === "on",
  };
}

export async function saveCategoryAction(
  subdomain: string,
  categoryId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runStoreAction(subdomain, { min: "staff" }, async ({ actor }) => {
    await withTenant(actor.storeId, async (tx) => {
      if (categoryId) await updateCategory(tx, actor, categoryId, readForm(formData));
      else await createCategory(tx, actor, readForm(formData));
    });
    catalogChanged(actor.storeId);
  });
  if (result?.ok && categoryId) return { ok: true, redirectTo: `/dashboard/${subdomain}/categories?saved=1` };
  if (result?.ok) {
    refresh();
    return { ok: true, message: "Category added." };
  }
  return result as ActionState;
}

export async function deleteCategoryAction(subdomain: string, categoryId: string): Promise<ActionState> {
  const result = await runStoreAction(subdomain, { min: "staff" }, async ({ actor }) => {
    await withTenant(actor.storeId, (tx) => deleteCategory(tx, actor, categoryId));
    catalogChanged(actor.storeId);
  });
  if (result?.ok) return { ok: true, redirectTo: `/dashboard/${subdomain}/categories?deleted=1` };
  return result as ActionState;
}
