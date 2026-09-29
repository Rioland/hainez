import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard";
import { requireStoreRole } from "@/server/auth/guards";
import { withTenant } from "@/server/db/tenant";
import { listCategories } from "@/server/modules/catalog/categories";
import { getProductForEdit } from "@/server/modules/catalog/products";
import { getStoreCurrency } from "@/server/modules/settings/settings";
import { storefrontUrl } from "@/server/tenancy/urls";
import { confirmImageUploadAction, deleteProductAction, requestImageUploadAction, saveProductAction } from "../actions";
import { DeleteButton } from "@/components/delete-button";
import { ProductForm } from "../_components/product-form";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params, searchParams }: PageProps<"/platform/dashboard/[store]/products/[productId]">) {
  const { store: subdomain, productId } = await params;
  const { store, access } = await requireStoreRole(subdomain);
  const data = await withTenant(store.storeId, async (tx) => ({
    product: await getProductForEdit(tx, store.storeId, productId),
    cats: await listCategories(tx, store.storeId),
    currency: await getStoreCurrency(tx, store.storeId),
  }));
  if (!data.product) notFound();
  const { product, cats, currency } = data;
  const readOnly = access.dashboard === "read_only";
  const sp = await searchParams;

  return (
    <div>
      <Link href={`/dashboard/${subdomain}/products`} className="text-sm text-muted hover:underline">
        ← Products
      </Link>
      <PageHeader
        title={product.title}
        description={
          product.status === "active" ? (
            <a href={storefrontUrl(subdomain, `/p/${product.slug}`)} target="_blank" className="text-brand hover:underline">
              View in store ↗
            </a>
          ) : (
            `Status: ${product.status}`
          )
        }
        actions={!readOnly && <DeleteButton action={deleteProductAction.bind(null, subdomain, product.id)} label="Delete product" />}
      />
      {(sp.created || sp.saved) && (
        <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{sp.created ? "Product created." : "Product saved."}</p>
      )}
      <ProductForm
        version={product.updatedAt.toISOString()}
        initial={{
          title: product.title,
          slug: product.slug,
          description: product.description ?? "",
          status: product.status,
          isFeatured: product.isFeatured,
          seoTitle: product.seoTitle ?? "",
          seoDescription: product.seoDescription ?? "",
          categoryIds: product.categoryIds,
          options: product.options,
          variants: product.variants.map((v) => ({
            id: v.id,
            optionValues: v.optionValues,
            priceMinor: v.priceMinor,
            compareAtPriceMinor: v.compareAtPriceMinor,
            sku: v.sku,
            stockQuantity: v.stockQuantity,
            trackInventory: v.trackInventory,
            allowBackorder: v.allowBackorder,
          })),
          images: product.images.map((i) => ({ mediaId: i.mediaId, url: i.url, alt: i.alt ?? "" })),
        }}
        categories={cats}
        currency={currency}
        action={saveProductAction.bind(null, subdomain, product.id)}
        requestUpload={requestImageUploadAction.bind(null, subdomain)}
        confirmUpload={confirmImageUploadAction.bind(null, subdomain)}
        readOnly={readOnly}
      />
    </div>
  );
}
