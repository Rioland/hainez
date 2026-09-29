import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/dashboard";
import { DeleteButton } from "@/components/delete-button";
import { Card } from "@/components/ui";
import { requireStoreRole } from "@/server/auth/guards";
import { withTenant } from "@/server/db/tenant";
import { listCategories } from "@/server/modules/catalog/categories";
import { deleteCategoryAction, saveCategoryAction } from "../actions";
import { CategoryForm } from "../category-form";

export const metadata: Metadata = { title: "Edit category" };

export default async function EditCategoryPage({ params }: PageProps<"/platform/dashboard/[store]/categories/[categoryId]">) {
  const { store: subdomain, categoryId } = await params;
  const { store, access } = await requireStoreRole(subdomain);
  const cats = await withTenant(store.storeId, (tx) => listCategories(tx, store.storeId));
  const category = cats.find((c) => c.id === categoryId);
  if (!category) notFound();
  const readOnly = access.dashboard === "read_only";

  // A category can't be moved under itself or one of its descendants.
  const descendants = new Set([category.id]);
  for (const c of cats) if (c.parentId && descendants.has(c.parentId)) descendants.add(c.id);

  return (
    <div className="space-y-6">
      <Link href={`/dashboard/${subdomain}/categories`} className="text-sm text-muted hover:underline">
        ← Categories
      </Link>
      <PageHeader
        title={category.name}
        description={`${category.productCount} products`}
        actions={
          !readOnly && (
            <DeleteButton
              action={deleteCategoryAction.bind(null, subdomain, category.id)}
              label="Delete category"
              confirmText="Delete this category? Its products stay; sub-categories move to the top level."
            />
          )
        }
      />
      <Card>
        <CategoryForm
          action={saveCategoryAction.bind(null, subdomain, category.id)}
          parents={cats.filter((c) => !descendants.has(c.id))}
          initial={category}
          submitLabel="Save category"
          readOnly={readOnly}
        />
      </Card>
    </div>
  );
}
