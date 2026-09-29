import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { IMAGE_TYPES, matchesImageSignature, type ImageType } from "@/lib/images";
import { media } from "../../db/schema";
import type { TenantTx } from "../../db/tenant";
import { env } from "../../env";
import { getStorage, storageUsable } from "../../storage";
import type { StoreActor } from "../_shared/actor";
import { DomainError } from "../_shared/errors";

export { IMAGE_TYPES, matchesImageSignature, type ImageType };

export const prepareUploadSchema = z.object({
  contentType: z.enum(Object.keys(IMAGE_TYPES) as [ImageType, ...ImageType[]], {
    error: "Only JPEG, PNG, WebP, AVIF or GIF images are allowed.",
  }),
  size: z.number().int().positive(),
});

/** Step 1: validate and hand the browser a short-lived signed upload URL. */
export async function prepareImageUpload(storeId: string, input: z.input<typeof prepareUploadSchema>) {
  const usable = storageUsable();
  if (!usable.ok) throw new DomainError(usable.reason);
  const { contentType, size } = prepareUploadSchema.parse(input);
  if (size > env.UPLOAD_MAX_BYTES) {
    throw new DomainError(`Images must be ${Math.round(env.UPLOAD_MAX_BYTES / 1024 / 1024)} MB or smaller.`);
  }
  const key = `stores/${storeId}/media/${randomUUID()}.${IMAGE_TYPES[contentType]}`;
  const { url, headers } = await getStorage().createUploadUrl({ key, contentType, contentLength: size });
  return { key, url, headers };
}

const KEY_RE = /^stores\/[0-9a-f-]{36}\/media\/[0-9a-f-]{36}\.(jpg|png|webp|avif|gif)$/;

export const confirmUploadSchema = z.object({
  key: z.string().regex(KEY_RE),
  alt: z.string().max(200).optional(),
});

/**
 * Step 2 (after the browser PUT the file): check the object really exists, is
 * small enough and is really an image, then record it in `media`.
 */
export async function confirmImageUpload(tx: TenantTx, actor: StoreActor, input: z.input<typeof confirmUploadSchema>) {
  const { key, alt } = confirmUploadSchema.parse(input);
  if (!key.startsWith(`stores/${actor.storeId}/`)) throw new DomainError("Upload does not belong to this store.");

  const storage = getStorage();
  const head = await storage.head(key);
  if (!head) throw new DomainError("Upload not found. Please try again.");

  const ext = key.split(".").pop() as (typeof IMAGE_TYPES)[ImageType];
  const type = (Object.entries(IMAGE_TYPES).find(([, e]) => e === ext)?.[0] ?? "image/jpeg") as ImageType;
  const start = await storage.readStart(key, 16);
  if (head.size > env.UPLOAD_MAX_BYTES || !start || !matchesImageSignature(start, type)) {
    await storage.delete(key);
    throw new DomainError("That file isn't a valid image.");
  }

  const [row] = await tx
    .insert(media)
    .values({
      storeId: actor.storeId,
      storageKey: key,
      contentType: type,
      byteSize: head.size,
      alt: alt ?? null,
      uploadedBy: actor.userId,
    })
    .returning({ id: media.id });
  return { id: row.id, url: storage.publicUrl(key) };
}

export function mediaUrl(storageKey: string): string {
  return getStorage().publicUrl(storageKey);
}
