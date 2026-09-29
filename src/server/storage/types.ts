/**
 * Object storage behind one interface, so the app doesn't care whether files
 * live in Cloudflare R2, another S3-compatible bucket, or on local disk in dev.
 *
 * Uploads go straight from the browser to storage with a short-lived signed
 * PUT URL; the app never proxies file bytes.
 */
export interface StorageAdapter {
  readonly driver: "local" | "s3";

  /** Signed URL the browser PUTs the file to. Valid for a few minutes. */
  createUploadUrl(input: { key: string; contentType: string; contentLength: number }): Promise<{
    url: string;
    headers: Record<string, string>;
  }>;

  /** Size and type of a stored object, or null if it doesn't exist. */
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;

  /** First `bytes` bytes of the object (used to check file signatures). */
  readStart(key: string, bytes: number): Promise<Uint8Array | null>;

  delete(key: string): Promise<void>;

  /** Public URL to display the object. */
  publicUrl(key: string): string;
}
