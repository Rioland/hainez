"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui";

export type ProductImage = { mediaId: string; url: string; alt: string };

type ActionResult<T> = { ok: true; data?: T } | { ok: false; error: string } | null;

type Props = {
  images: ProductImage[];
  onChange: (images: ProductImage[]) => void;
  requestUpload: (input: { contentType: string; size: number }) => Promise<ActionResult<{ key: string; url: string; headers: Record<string, string> }>>;
  confirmUpload: (input: { key: string }) => Promise<ActionResult<{ id: string; url: string }>>;
  disabled?: boolean;
};

/**
 * Uploads go browser -> storage directly with a signed URL, then the server
 * verifies the file and records it. Order = display order (first is the main image).
 */
export function ImageManager({ images, onChange, requestUpload, confirmUpload, disabled }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(files: FileList) {
    setError(null);
    let current = images;
    for (const [i, file] of [...files].entries()) {
      setBusy(`Uploading ${i + 1} of ${files.length}…`);
      const prepared = await requestUpload({ contentType: file.type, size: file.size });
      if (!prepared?.ok || !prepared.data) {
        setError(prepared && !prepared.ok ? prepared.error : "Upload failed");
        break;
      }
      const put = await fetch(prepared.data.url, { method: "PUT", headers: prepared.data.headers, body: file }).catch(() => null);
      if (!put?.ok) {
        setError("Upload failed. Please try again.");
        break;
      }
      const confirmed = await confirmUpload({ key: prepared.data.key });
      if (!confirmed?.ok || !confirmed.data) {
        setError(confirmed && !confirmed.ok ? confirmed.error : "Upload failed");
        break;
      }
      current = [...current, { mediaId: confirmed.data.id, url: confirmed.data.url, alt: "" }];
      onChange(current);
    }
    setBusy(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  const move = (from: number, to: number) => {
    const next = [...images];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {images.map((img, i) => (
          <div key={img.mediaId} className="rounded-lg border border-border p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt={img.alt || "Product image"} className="aspect-square w-full rounded-md object-cover" />
            <input
              value={img.alt}
              onChange={(e) => onChange(images.map((x, j) => (j === i ? { ...x, alt: e.target.value } : x)))}
              placeholder="Alt text"
              maxLength={200}
              disabled={disabled}
              className="mt-2 w-full rounded border border-border px-2 py-1 text-xs"
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
              <span className="text-muted">{i === 0 ? "Main image" : `#${i + 1}`}</span>
              <span className="flex gap-3">
                <button type="button" disabled={disabled || i === 0} onClick={() => move(i, i - 1)} aria-label="Move left" className="disabled:opacity-30">
                  ←
                </button>
                <button
                  type="button"
                  disabled={disabled || i === images.length - 1}
                  onClick={() => move(i, i + 1)}
                  aria-label="Move right"
                  className="disabled:opacity-30"
                >
                  →
                </button>
                <button type="button" disabled={disabled} onClick={() => onChange(images.filter((_, j) => j !== i))} className="text-red-600">
                  Remove
                </button>
              </span>
            </div>
          </div>
        ))}
        <button
          type="button"
          disabled={disabled || Boolean(busy)}
          onClick={() => inputRef.current?.click()}
          className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed border-border text-sm text-muted hover:bg-slate-50 disabled:opacity-50"
        >
          {busy ?? "+ Add images"}
          <span className="mt-1 text-xs">JPEG, PNG, WebP · max 5 MB</span>
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        multiple
        hidden
        onChange={(e) => e.target.files?.length && upload(e.target.files)}
      />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      {images.length > 1 && !disabled && (
        <Button type="button" variant="ghost" className="mt-2 text-xs" onClick={() => onChange([])}>
          Remove all images
        </Button>
      )}
    </div>
  );
}
