import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { shippingMethods, stores } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { audit } from "../audit/audit";
import type { StoreActor } from "../_shared/actor";
import { NotFoundError } from "../_shared/errors";

/* Store settings and shipping methods (tenant-scoped). */

export const TIMEZONES = ["Africa/Lagos", "Africa/Accra", "Africa/Nairobi", "Africa/Johannesburg", "Europe/London", "UTC"] as const;

/** Nigerian states + FCT, for shipping regions. Code -> name. */
export const NG_STATES: Record<string, string> = {
  AB: "Abia", AD: "Adamawa", AK: "Akwa Ibom", AN: "Anambra", BA: "Bauchi", BY: "Bayelsa", BE: "Benue", BO: "Borno",
  CR: "Cross River", DE: "Delta", EB: "Ebonyi", ED: "Edo", EK: "Ekiti", EN: "Enugu", FC: "FCT Abuja", GO: "Gombe",
  IM: "Imo", JI: "Jigawa", KD: "Kaduna", KN: "Kano", KT: "Katsina", KE: "Kebbi", KO: "Kogi", KW: "Kwara", LA: "Lagos",
  NA: "Nasarawa", NI: "Niger", OG: "Ogun", ON: "Ondo", OS: "Osun", OY: "Oyo", PL: "Plateau", RI: "Rivers", SO: "Sokoto",
  TA: "Taraba", YO: "Yobe", ZA: "Zamfara",
};

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

export const settingsInput = z.object({
  name: z.string().trim().min(2, "At least 2 characters").max(80),
  contactEmail: z
    .string()
    .trim()
    .max(254)
    .optional()
    .transform((v) => (v ? v : null))
    .pipe(z.email("Enter a valid email").nullable()),
  contactPhone: optional(30),
  currency: z.enum(SUPPORTED_CURRENCIES),
  timezone: z.enum(TIMEZONES),
  address: z
    .object({
      line1: optional(200),
      line2: optional(200),
      city: optional(100),
      state: optional(100),
      country: z.string().trim().length(2).default("NG"),
    })
    .optional(),
});
export type SettingsInput = z.input<typeof settingsInput>;

export async function getSettings(tx: TenantTx, storeId: string) {
  const [row] = await tx
    .select({
      name: stores.name,
      subdomain: stores.subdomain,
      contactEmail: stores.contactEmail,
      contactPhone: stores.contactPhone,
      currency: stores.currency,
      timezone: stores.timezone,
      address: stores.address,
    })
    .from(stores)
    .where(eq(stores.id, storeId));
  if (!row) throw new NotFoundError("Store");
  return { ...row, address: (row.address ?? {}) as Record<string, string | null> };
}

export async function getStoreCurrency(tx: TenantTx, storeId: string): Promise<string> {
  const [row] = await tx.select({ currency: stores.currency }).from(stores).where(eq(stores.id, storeId));
  return row?.currency ?? "NGN";
}

export async function updateSettings(tx: TenantTx, actor: StoreActor, raw: SettingsInput) {
  const input = settingsInput.parse(raw);
  const before = await getSettings(tx, actor.storeId);
  // The app_tenant role may only UPDATE these columns (see 0002_tenant_grants.sql).
  await tx
    .update(stores)
    .set({
      name: input.name,
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      currency: input.currency,
      timezone: input.timezone,
      address: input.address ?? null,
      updatedAt: new Date(),
    })
    .where(eq(stores.id, actor.storeId));
  const changed = Object.fromEntries(
    (["name", "contactEmail", "contactPhone", "currency", "timezone"] as const)
      .filter((k) => before[k] !== input[k])
      .map((k) => [k, [before[k], input[k]]]),
  );
  await audit(tx, actor, { action: "store.settings_update", entityType: "store", entityId: actor.storeId, changes: changed });
}

/* ---------------------------------------------------------------- shipping */

export const shippingInput = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(80),
    description: optional(300),
    priceMinor: z.number().int().min(0).max(100_000_000_00),
    freeOverMinor: z.number().int().min(0).max(100_000_000_00).nullable().optional(),
    regions: z.array(z.string().refine((c) => c in NG_STATES, "Unknown state")).max(40).default([]),
    minDays: z.number().int().min(0).max(90).nullable().optional(),
    maxDays: z.number().int().min(0).max(90).nullable().optional(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.minDays == null || v.maxDays == null || v.minDays <= v.maxDays, {
    path: ["maxDays"],
    message: "Must be at least the minimum",
  });
export type ShippingInput = z.input<typeof shippingInput>;

export async function listShippingMethods(tx: TenantTx, storeId: string) {
  return tx
    .select()
    .from(shippingMethods)
    .where(eq(shippingMethods.storeId, storeId))
    .orderBy(asc(shippingMethods.position), asc(shippingMethods.name));
}

export async function saveShippingMethod(tx: TenantTx, actor: StoreActor, id: string | null, raw: ShippingInput) {
  const input = shippingInput.parse(raw);
  const values = {
    ...input,
    freeOverMinor: input.freeOverMinor ?? null,
    minDays: input.minDays ?? null,
    maxDays: input.maxDays ?? null,
  };
  if (id) {
    const [row] = await tx
      .update(shippingMethods)
      .set(values)
      .where(and(eq(shippingMethods.storeId, actor.storeId), eq(shippingMethods.id, id)))
      .returning({ id: shippingMethods.id });
    if (!row) throw new NotFoundError("Shipping method");
  } else {
    [{ id }] = await tx.insert(shippingMethods).values({ ...values, storeId: actor.storeId }).returning({ id: shippingMethods.id });
  }
  await audit(tx, actor, { action: "shipping.save", entityType: "shipping_method", entityId: id!, changes: { name: input.name, priceMinor: input.priceMinor } });
  return { id: id! };
}

/** Past orders keep the method's name (snapshot); their reference is cleared by the FK. */
export async function deleteShippingMethod(tx: TenantTx, actor: StoreActor, id: string) {
  const [row] = await tx
    .delete(shippingMethods)
    .where(and(eq(shippingMethods.storeId, actor.storeId), eq(shippingMethods.id, id)))
    .returning({ name: shippingMethods.name });
  if (!row) throw new NotFoundError("Shipping method");
  await audit(tx, actor, { action: "shipping.delete", entityType: "shipping_method", entityId: id, changes: { name: row.name } });
}
