"use server";

import { refresh } from "next/cache";
import { parseMoney } from "@/lib/money";
import { withTenant } from "@/server/db/tenant";
import { settingsChanged } from "@/server/modules/catalog/cache";
import { deleteShippingMethod, saveShippingMethod, updateSettings } from "@/server/modules/settings/settings";
import { runStoreAction, type ActionState } from "@/server/modules/_shared/action";
import { DomainError } from "@/server/modules/_shared/errors";
import { invalidateStore } from "@/server/tenancy/resolve";

const text = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function saveSettingsAction(subdomain: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runStoreAction(subdomain, { min: "admin" }, async ({ actor }) => {
    await withTenant(actor.storeId, (tx) =>
      updateSettings(tx, actor, {
        name: text(formData, "name"),
        contactEmail: text(formData, "contactEmail"),
        contactPhone: text(formData, "contactPhone"),
        currency: text(formData, "currency") as never,
        timezone: text(formData, "timezone") as never,
        address: {
          line1: text(formData, "line1"),
          line2: text(formData, "line2"),
          city: text(formData, "city"),
          state: text(formData, "state"),
          country: text(formData, "country") || "NG",
        },
      }),
    );
    settingsChanged(actor.storeId);
    invalidateStore(actor.storeId);
  });
  if (result?.ok) {
    refresh();
    return { ok: true, message: "Settings saved." };
  }
  return result as ActionState;
}

function readShipping(f: FormData) {
  const price = parseMoney(text(f, "price"));
  if (price === null) throw new DomainError("Enter a valid delivery price.", { price: ["Enter a valid amount"] });
  const freeRaw = text(f, "freeOver").trim();
  const freeOver = freeRaw ? parseMoney(freeRaw) : null;
  if (freeRaw && freeOver === null) throw new DomainError("Enter a valid amount.", { freeOver: ["Enter a valid amount"] });
  const int = (k: string) => (text(f, k).trim() === "" ? null : Number.parseInt(text(f, k), 10));
  return {
    name: text(f, "name"),
    description: text(f, "description"),
    priceMinor: price,
    freeOverMinor: freeOver,
    regions: f.getAll("regions").map(String),
    minDays: int("minDays"),
    maxDays: int("maxDays"),
    isActive: f.get("isActive") === "on",
  };
}

export async function saveShippingAction(subdomain: string, id: string | null, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const result = await runStoreAction(subdomain, { min: "admin" }, async ({ actor }) => {
    await withTenant(actor.storeId, (tx) => saveShippingMethod(tx, actor, id, readShipping(formData)));
    settingsChanged(actor.storeId);
  });
  if (result?.ok) {
    refresh();
    return { ok: true, message: id ? "Delivery option saved." : "Delivery option added." };
  }
  return result as ActionState;
}

export async function deleteShippingAction(subdomain: string, id: string): Promise<ActionState> {
  const result = await runStoreAction(subdomain, { min: "admin" }, async ({ actor }) => {
    await withTenant(actor.storeId, (tx) => deleteShippingMethod(tx, actor, id));
    settingsChanged(actor.storeId);
  });
  if (result?.ok) refresh();
  return result as ActionState;
}
