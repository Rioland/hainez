import Link from "next/link";
import type { ReactNode } from "react";

/* Server-safe building blocks for dashboard pages. */

export function PageHeader({ title, description, actions }: { title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Table({ head, children, empty }: { head: ReactNode[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-slate-50 text-xs uppercase tracking-wide text-muted">
          <tr>
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_tr]:border-b [&_tr]:border-border [&_tr:last-child]:border-0 [&_td]:px-4 [&_td]:py-3">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Tabs rendered as links that set a query param (server-side filtering). */
export function FilterTabs({
  base,
  param,
  current,
  options,
  keep = {},
}: {
  base: string;
  param: string;
  current: string | undefined;
  options: { value: string | undefined; label: string }[];
  keep?: Record<string, string | undefined>;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
      {options.map((o) => {
        const params = new URLSearchParams(Object.entries({ ...keep, [param]: o.value }).filter(([, v]) => v) as [string, string][]);
        const active = (current ?? undefined) === o.value;
        return (
          <Link
            key={o.label}
            href={`${base}${params.size ? `?${params}` : ""}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? "border-brand font-medium text-foreground" : "border-transparent text-muted hover:text-foreground"}`}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

export function Pagination({
  base,
  page,
  pageCount,
  total,
  params = {},
}: {
  base: string;
  page: number;
  pageCount: number;
  total: number;
  params?: Record<string, string | undefined>;
}) {
  if (pageCount <= 1) return <p className="mt-3 text-xs text-muted">{total} total</p>;
  const link = (p: number) => {
    const q = new URLSearchParams(Object.entries({ ...params, page: String(p) }).filter(([, v]) => v) as [string, string][]);
    return `${base}?${q}`;
  };
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <span className="text-muted">
        Page {page} of {pageCount} · {total} total
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={link(page - 1)} className="rounded-lg border border-border bg-white px-3 py-1.5 hover:bg-slate-50">
            Previous
          </Link>
        )}
        {page < pageCount && (
          <Link href={link(page + 1)} className="rounded-lg border border-border bg-white px-3 py-1.5 hover:bg-slate-50">
            Next
          </Link>
        )}
      </div>
    </div>
  );
}

/** Plain <img> for user-uploaded media (sizes are small; optimisation comes with the CDN). */
export function Thumb({ src, alt, size = 40 }: { src: string | null; alt: string; size?: number }) {
  if (!src) return <div className="rounded-md border border-dashed border-border bg-slate-50" style={{ width: size, height: size }} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} width={size} height={size} className="rounded-md border border-border object-cover" style={{ width: size, height: size }} />;
}
