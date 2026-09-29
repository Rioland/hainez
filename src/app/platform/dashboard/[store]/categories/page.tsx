import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, PageHeader, Table } from "@/components/dashboard";
import { Badge, Card } from "@/components/ui";
import { requireStoreRole } from "@/server/auth/guards";
import { withTenant } from "@/server/db/tenant";
import { listCategories } from "@/server/modules/catalog/categories";
import { saveCategoryAction } from "./actions";
import { CategoryForm } from "./category-form";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage({ params, searchParams }: PageProps<"/platform/dashboard/[store]/categories">) {
  const { store: subdomain } = await params;
  const sp = await searchParams;
  const { store, access } = await requireStoreRole(subdomain);
  const cats = await withTenant(store.storeId, (tx) => listCategories(tx, store.storeId));
  const readOnly = access.dashboard === "read_only";

  return (
    <div className="space-y-6">
      <PageHeader title="Categories" description="Group products so customers can browse your store." />
      {sp.saved && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Category saved.</p>}
      {sp.deleted && <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Category deleted.</p>}

      <Card>
        <h2 className="mb-4 font-medium">Add a category</h2>
        <CategoryForm action={saveCategoryAction.bind(null, subdomain, null)} parents={cats} submitLabel="Add category" readOnly={readOnly} />
      </Card>

      <Table head={["Name", "Handle", "Products", "Status"]} empty={cats.length === 0 && <EmptyState title="No categories yet" />}>
        {cats.map((c) => (
          <tr key={c.id}>
            <td style={{ paddingLeft: 16 + c.depth * 20 }}>
              <Link href={`/dashboard/${subdomain}/categories/${c.id}`} className="font-medium hover:underline">
                {c.depth > 0 && <span className="text-muted">↳ </span>}
                {c.name}
              </Link>
            </td>
            <td className="font-mono text-xs text-muted">{c.slug}</td>
            <td>
              <Link href={`/dashboard/${subdomain}/products?category=${c.id}`} className="hover:underline">
                {c.productCount}
              </Link>
            </td>
            <td>{c.isActive ? <Badge tone="good">visible</Badge> : <Badge>hidden</Badge>}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
