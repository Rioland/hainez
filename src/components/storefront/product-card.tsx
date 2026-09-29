import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { ProductCard as Card } from "@/server/modules/storefront/catalog";

export function Price({ min, max, compareAt, currency, className = "" }: { min: number; max?: number; compareAt?: number | null; currency: string; className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 ${className}`}>
      <span className="font-semibold">
        {max !== undefined && max !== min ? `${formatMoney(min, currency)} – ${formatMoney(max, currency)}` : formatMoney(min, currency)}
      </span>
      {compareAt ? <span className="text-sm text-muted line-through">{formatMoney(compareAt, currency)}</span> : null}
    </span>
  );
}

export function ProductCard({ product, base, currency }: { product: Card; base: string; currency: string }) {
  return (
    <Link href={`${base}/p/${product.slug}`} className="group block">
      <div className="relative aspect-square overflow-hidden rounded-xl border border-border bg-slate-50">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.imageUrl} alt={product.title} loading="lazy" className="h-full w-full object-cover transition group-hover:scale-105" />
        ) : (
          <div className="flex h-full items-center justify-center text-3xl text-slate-300">◻︎</div>
        )}
        {product.compareAt && <span className="absolute left-2 top-2 rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-brand-foreground">Sale</span>}
        {!product.available && <span className="absolute right-2 top-2 rounded-full bg-slate-900/80 px-2 py-0.5 text-xs text-white">Sold out</span>}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium group-hover:underline">{product.title}</h3>
      <Price min={product.minPrice} max={product.maxPrice} compareAt={product.compareAt} currency={currency} className="text-sm" />
    </Link>
  );
}

export function ProductGrid({ products, base, currency }: { products: Card[]; base: string; currency: string }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} base={base} currency={currency} />
      ))}
    </div>
  );
}
