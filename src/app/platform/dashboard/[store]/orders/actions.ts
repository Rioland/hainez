"use server";

import { refresh } from "next/cache";
import { withTenant } from "@/server/db/tenant";
import { catalogChanged } from "@/server/modules/catalog/cache";
import { changeOrderStatus, updateInternalNote } from "@/server/modules/orders/orders";
import { runStoreAction, type ActionState } from "@/server/modules/_shared/action";

export async function changeOrderStatusAction(
  subdomain: string,
  orderId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const result = await runStoreAction(subdomain, { min: "staff" }, async ({ actor }) => {
    await withTenant(actor.storeId, (tx) =>
      changeOrderStatus(tx, actor, orderId, {
        to: String(formData.get("to")) as never,
        note: String(formData.get("note") ?? ""),
        trackingNumber: String(formData.get("trackingNumber") ?? ""),
      }),
    );
    catalogChanged(actor.storeId); // stock levels may have changed
  });
  if (result?.ok) {
    refresh();
    return { ok: true, message: "Order updated." };
  }
  return result as ActionState;
}

export async function saveOrderNoteAction(subdomain: string, orderId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runStoreAction(subdomain, { min: "staff" }, async ({ actor }) => {
    await withTenant(actor.storeId, (tx) => updateInternalNote(tx, actor, orderId, String(formData.get("note") ?? "")));
  });
  if (result?.ok) {
    refresh();
    return { ok: true, message: "Note saved." };
  }
  return result as ActionState;
}
