import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/dashboard";
import { requireStoreRole } from "@/server/auth/guards";
import { withTenant } from "@/server/db/tenant";
import { listCategories } from "@/server/modules/catalog/categories";
import { getStoreCurrency } from "@/server/modules/settings/settings";
import { confirmImageUploadAction, requestImageUploadAction, saveProductAction } from "../actions";
import { ProductForm } from "../_components/product-form";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage({ params }: PageProps<"/platform/dashboard/[store]/products/new">) {
  const { store: subdomain } = await params;
  const { store, access } = await requireStoreRole(subdomain);
  const { cats, currency } = await withTenant(store.storeId, async (tx) => ({
    cats: await listCategories(tx, store.storeId),
    currency: await getStoreCurrency(tx, store.storeId),
  }));

  return (
    <div>
      <Link href={`/dashboard/${subdomain}/products`} className="text-sm text-muted hover:underline">
        ← Products
      </Link>
      <PageHeader title="Add product" />
      <ProductForm
        version="new"
        initial={{
          title: "",
          slug: "",
          description: "",
          status: "active",
          isFeatured: false,
          seoTitle: "",
          seoDescription: "",
          categoryIds: [],
          options: [],
          variants: [],
          images: [],
        }}
        categories={cats}
        currency={currency}
        action={saveProductAction.bind(null, subdomain, null)}
        requestUpload={requestImageUploadAction.bind(null, subdomain)}
        confirmUpload={confirmImageUploadAction.bind(null, subdomain)}
        readOnly={access.dashboard === "read_only"}
      />
    </div>
  );
}
