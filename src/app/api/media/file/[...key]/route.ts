import { env } from "@/server/env";
import { readLocalObject } from "@/server/storage/local";

/** Dev-only file server for STORAGE_DRIVER=local. In production, files come from the bucket's public URL. */
export async function GET(_request: Request, ctx: RouteContext<"/api/media/file/[...key]">) {
  if (env.STORAGE_DRIVER !== "local") return new Response("Not found", { status: 404 });
  const { key } = await ctx.params;
  const object = await readLocalObject(key.join("/")).catch(() => null);
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(object.data), {
    headers: {
      "content-type": object.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
