import { AwsClient } from "aws4fetch";
import type { StorageAdapter } from "./types";

export type S3Config = {
  endpoint: string; // https://<account>.r2.cloudflarestorage.com
  region: string; // "auto" for R2
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string; // https://cdn.example.com
};

const UPLOAD_URL_TTL_SECONDS = 300;

const encodeKey = (key: string) => key.split("/").map(encodeURIComponent).join("/");

/** S3-compatible storage (Cloudflare R2 recommended) using SigV4 via aws4fetch. */
export function createS3Storage(cfg: S3Config): StorageAdapter {
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    service: "s3",
  });
  const objectUrl = (key: string) => `${cfg.endpoint.replace(/\/$/, "")}/${cfg.bucket}/${encodeKey(key)}`;

  return {
    driver: "s3",

    async createUploadUrl({ key, contentType }) {
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", String(UPLOAD_URL_TTL_SECONDS));
      const signed = await client.sign(new Request(url, { method: "PUT", headers: { "content-type": contentType } }), {
        aws: { signQuery: true, allHeaders: true },
      });
      return { url: signed.url, headers: { "content-type": contentType } };
    },

    async head(key) {
      const res = await client.fetch(objectUrl(key), { method: "HEAD" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`storage HEAD failed: ${res.status}`);
      return { size: Number(res.headers.get("content-length") ?? 0), contentType: res.headers.get("content-type") };
    },

    async readStart(key, bytes) {
      const res = await client.fetch(objectUrl(key), { headers: { range: `bytes=0-${bytes - 1}` } });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`storage GET failed: ${res.status}`);
      return new Uint8Array(await res.arrayBuffer()).slice(0, bytes);
    },

    async delete(key) {
      const res = await client.fetch(objectUrl(key), { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`storage DELETE failed: ${res.status}`);
    },

    publicUrl(key) {
      return `${cfg.publicUrl.replace(/\/$/, "")}/${encodeKey(key)}`;
    },
  };
}
