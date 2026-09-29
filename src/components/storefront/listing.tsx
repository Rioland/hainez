import Link from "next/link";
import type { ProductSort } from "@/server/modules/storefront/catalog";

const SORTS: { value: ProductSort; label: string }[] = [
  { value: "newest", label: "Newest" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
];

export function parseSort(v: unknown): ProductSort {
  return v === "price_asc" || v === "price_desc" ? v : "newest";
}

const qs = (params: Record<string, string | number | undefined>) => {
  const s = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== "") as [string, string][]);
  return s.size ? `?${s}` : "";
};

export function SortLinks({ path, sort, keep = {} }: { path: string; sort: ProductSort; keep?: Record<string, string | undefined> }) {
  return (
    <div className="flex flex-wrap gap-2 text-sm">
      {SORTS.map((s) => (
        <Link
          key={s.value}
          href={`${path}${qs({ ...keep, sort: s.value === "newest" ? undefined : s.value })}`}
          className={`rounded-full border px-3 py-1 ${sort === s.value ? "border-foreground bg-foreground text-white" : "border-border hover:border-foreground"}`}
        >
          {s.label}
        </Link>
      ))}
    </div>
  );
}

export function PageLinks({ path, page, pageCount, keep = {} }: { path: string; page: number; pageCount: number; keep?: Record<string, string | undefined> }) {
  if (pageCount <= 1) return null;
  return (
    <nav className="mt-10 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
      {page > 1 && (
        <Link href={`${path}${qs({ ...keep, page: page - 1 })}`} className="rounded-full border border-border px-4 py-2 hover:border-foreground">
          ← Previous
        </Link>
      )}
      <span className="text-muted">
        Page {page} of {pageCount}
      </span>
      {page < pageCount && (
        <Link href={`${path}${qs({ ...keep, page: page + 1 })}`} className="rounded-full border border-border px-4 py-2 hover:border-foreground">
          Next →
        </Link>
      )}
    </nav>
  );
}

export const pageNumber = (v: unknown) => Math.max(1, Math.min(500, Number.parseInt(String(v ?? "1"), 10) || 1));
