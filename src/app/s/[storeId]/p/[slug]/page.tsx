import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/ui";
import { AddToCart } from "@/components/storefront/add-to-cart";
import { Gallery } from "@/components/storefront/gallery";
import { getPublicProduct, getPublicStore } from "@/server/modules/storefront/catalog";
import { requestBasePath } from "@/server/modules/storefront/context";
import { storefrontUrl } from "@/server/tenancy/urls";
import { addToCartAction } from "../../actions";

const excerpt = (text: string | null, n = 160) => (text ? text.replace(/\s+/g, " ").trim().slice(0, n) : undefined);

export async function generateMetadata({ params }: PageProps<"/s/[storeId]/p/[slug]">): Promise<Metadata> {
  const { storeId, slug } = await params;
  const [product, store] = await Promise.all([getPublicProduct(storeId, slug), getPublicStore(storeId)]);
  if (!product || !store) return {};
  const url = storefrontUrl(store.subdomain, `/p/${slug}`, store.primaryHost);
  const description = product.seoDescription ?? excerpt(product.description) ?? `Buy ${product.title} at ${store.name}.`;
  return {
    title: product.seoTitle ?? product.title,
    description,
    alternates: { canonical: url },
    openGraph: {
      title: product.seoTitle ?? product.title,
      description,
      url,
      images: product.images.slice(0, 1).map((i) => ({ url: i.url, alt: i.alt ?? product.title })),
    },
  };
}

export default async function ProductPage({ params }: PageProps<"/s/[storeId]/p/[slug]">) {
  const { storeId, slug } = await params;
  const [product, store, base] = await Promise.all([getPublicProduct(storeId, slug), getPublicStore(storeId), requestBasePath()]);
  if (!product || !store) notFound();

  const prices = product.variants.map((v) => v.price);
  // Structured data so search engines can show price and availability.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: excerpt(product.description, 500),
    image: product.images.map((i) => i.url),
    sku: product.variants[0]?.sku ?? undefined,
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: store.currency,
      lowPrice: (Math.min(...prices) / 100).toFixed(2),
      highPrice: (Math.max(...prices) / 100).toFixed(2),
      offerCount: product.variants.length,
      availability: product.variants.some((v) => v.available) ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: storefrontUrl(store.subdomain, `/p/${slug}`, store.primaryHost),
    },
  };

  return (
    <Container className="py-8">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav className="mb-6 text-sm text-muted">
        <Link href={base || "/"} className="hover:underline">
          Home
        </Link>
        {product.categories[0] && (
          <>
            {" / "}
            <Link href={`${base}/c/${product.categories[0].slug}`} className="hover:underline">
              {product.categories[0].name}
            </Link>
          </>
        )}
      </nav>
      <div className="grid gap-10 md:grid-cols-2">
        <Gallery images={product.images} title={product.title} />
        <div>
          <h1 className="text-3xl font-semibold">{product.title}</h1>
          <div className="mt-6">
            <AddToCart options={product.options} variants={product.variants} currency={store.currency} cartHref={`${base}/cart`} action={addToCartAction} />
          </div>
          {product.description && (
            <div className="mt-10 border-t border-border pt-6">
              <h2 className="mb-2 font-medium">Description</h2>
              <p className="whitespace-pre-line leading-relaxed text-muted">{product.description}</p>
            </div>
          )}
        </div>
      </div>
    </Container>
  );
}
