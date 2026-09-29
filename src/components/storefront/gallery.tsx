"use client";

import { useState } from "react";

export function Gallery({ images, title }: { images: { url: string; alt: string | null }[]; title: string }) {
  const [index, setIndex] = useState(0);
  if (images.length === 0) {
    return <div className="flex aspect-square items-center justify-center rounded-2xl border border-border bg-slate-50 text-5xl text-slate-300">◻︎</div>;
  }
  const current = images[Math.min(index, images.length - 1)];
  return (
    <div>
      <div className="aspect-square overflow-hidden rounded-2xl border border-border bg-slate-50">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current.url} alt={current.alt || title} className="h-full w-full object-cover" />
      </div>
      {images.length > 1 && (
        <div className="mt-3 grid grid-cols-5 gap-2">
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={`Show image ${i + 1}`}
              className={`aspect-square overflow-hidden rounded-lg border ${i === index ? "border-foreground" : "border-border"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
