import { z } from "zod";

/**
 * Validated server environment. Import this instead of reading process.env
 * directly so a missing/invalid variable fails loudly at startup.
 *
 * Not marked `server-only` because scripts (migrate, seed) and tests import it
 * too; nothing here is ever sent to the browser.
 */

const bool = z
  .enum(["true", "false", "1", "0"])
  .transform((v) => v === "true" || v === "1");

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

    // Pooled connection string used by the app (Neon: the "-pooler" URL).
    DATABASE_URL: z.string().url(),
    // Direct (non-pooled) connection for migrations. Falls back to DATABASE_URL.
    DATABASE_URL_UNPOOLED: z.string().url().optional(),

    BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),

    /**
     * How tenants are addressed:
     *  - "subdomain": {store}.ROOT_DOMAIN, app.ROOT_DOMAIN, admin.ROOT_DOMAIN (needs a real domain)
     *  - "path":      ROOT_DOMAIN/store/{store}, ROOT_DOMAIN/admin (works on *.vercel.app)
     */
    ROUTING_MODE: z.enum(["subdomain", "path"]).default("subdomain"),
    /** Host (and port in dev) of the platform, e.g. "localhost:3000" or "yourbrand.com". */
    ROOT_DOMAIN: z.string().min(1).optional(),
    /** Use https:// when building absolute URLs. Defaults to true in production. */
    USE_HTTPS: bool.optional(),
    /** 301 store traffic to its primary custom domain. Defaults to true in production. */
    ENFORCE_CANONICAL_HOST: bool.optional(),

    PLATFORM_NAME: z.string().default("StoreBuilder"),

    /**
     * Where uploaded images go.
     *  - "local": ./.data/uploads, served by the app (development only; Vercel's disk is not persistent)
     *  - "s3":    any S3-compatible bucket, e.g. Cloudflare R2
     */
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    S3_ENDPOINT: z.string().url().optional(), // R2: https://<account-id>.r2.cloudflarestorage.com
    S3_REGION: z.string().default("auto"),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    /** Public base URL for objects, e.g. https://cdn.yourbrand.com or the bucket's r2.dev URL. */
    S3_PUBLIC_URL: z.string().url().optional(),
    UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

    // Set automatically by Vercel, e.g. "multistore-builder.vercel.app".
    VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_DRIVER === "s3") {
      for (const key of ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_PUBLIC_URL"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `required when STORAGE_DRIVER=s3` });
      }
    }
  })
  .transform((env) => {
    const rootDomain = (env.ROOT_DOMAIN ?? env.VERCEL_PROJECT_PRODUCTION_URL ?? "localhost:3000").toLowerCase();
    const isProd = env.NODE_ENV === "production";
    return {
      ...env,
      ROOT_DOMAIN: rootDomain,
      USE_HTTPS: env.USE_HTTPS ?? isProd,
      ENFORCE_CANONICAL_HOST: env.ENFORCE_CANONICAL_HOST ?? isProd,
    };
  });

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment variables:\n${issues}\nSee .env.example.`);
  }
  return parsed.data;
}

export const env: Env = load();
