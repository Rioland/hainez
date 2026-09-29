import { env } from "@/server/env";
import { verifyLocalUpload, writeLocalObject } from "@/server/storage/local";

/**
 * Dev-only upload target for STORAGE_DRIVER=local. Mirrors an S3 presigned PUT:
 * the signature binds key, content type, size and expiry.
 */
export async function PUT(request: Request) {
  if (env.STORAGE_DRIVER !== "local") return new Response("Not found", { status: 404 });

  const q = new URL(request.url).searchParams;
  const params = {
    key: q.get("key") ?? "",
    contentType: q.get("type") ?? "",
    length: Number(q.get("len")),
    exp: Number(q.get("exp")),
    sig: q.get("sig") ?? "",
  };
  if (!verifyLocalUpload(env.BETTER_AUTH_SECRET, params)) return new Response("Invalid or expired signature", { status: 403 });
  if (request.headers.get("content-type") !== params.contentType) return new Response("Content-Type mismatch", { status: 400 });

  const data = new Uint8Array(await request.arrayBuffer());
  if (data.byteLength !== params.length) return new Response("Size mismatch", { status: 400 });

  await writeLocalObject(params.key, data, params.contentType);
  return new Response(null, { status: 200 });
}
