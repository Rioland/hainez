import "server-only";
import { env } from "../env";
import { platformUrl } from "../tenancy/urls";
import { createLocalStorage } from "./local";
import { createS3Storage } from "./s3";
import type { StorageAdapter } from "./types";

export type { StorageAdapter } from "./types";

let instance: StorageAdapter | null = null;

/** The configured storage adapter (STORAGE_DRIVER). */
export function getStorage(): StorageAdapter {
  if (instance) return instance;
  instance =
    env.STORAGE_DRIVER === "s3"
      ? createS3Storage({
          endpoint: env.S3_ENDPOINT!,
          region: env.S3_REGION,
          bucket: env.S3_BUCKET!,
          accessKeyId: env.S3_ACCESS_KEY_ID!,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
          publicUrl: env.S3_PUBLIC_URL!,
        })
      : createLocalStorage({ secret: env.BETTER_AUTH_SECRET, baseUrl: platformUrl("").replace(/\/$/, "") });
  return instance;
}

/**
 * Local disk storage can't work on serverless hosting (Vercel's filesystem is
 * wiped between invocations); say so clearly instead of losing files. On a
 * server with a persistent disk (e.g. the VPS) local storage is allowed.
 */
export function storageUsable(): { ok: true } | { ok: false; reason: string } {
  if (env.STORAGE_DRIVER === "local" && process.env.VERCEL) {
    return {
      ok: false,
      reason: "Image storage isn't configured yet. Set STORAGE_DRIVER=s3 and the S3_* variables (e.g. Cloudflare R2).",
    };
  }
  return { ok: true };
}
