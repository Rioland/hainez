import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, FilterTabs, PageHeader, Pagination, Table, Thumb } from "@/components/dashboard";
import { Badge, ButtonLink } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { requireStoreRole } from "@/server/auth/guards";
import { withTenant } from "@/server/db/tenant";
import { listCategories } from "@/server/modules/catalog/categories";
import { listProducts } from "@/server/modules/catalog/products";
import { getStoreCurrency } from "@/server/modules/settings/settings";

export const metadata: Metadata = { title: "Products" };

const STATUS_TONE = { active: "good", draft: "neutral", archived: "warn" } as const;

export default async function ProductsPage({ params, searchParams }: PageProps<"/platform/dashboard/[store]/products">) {
  const { store: subdomain } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  const status = typeof sp.status === "string" ? sp.status : undefined;
  const category = typeof sp.category === "string" ? sp.category : undefined;

  const { store, access } = await requireStoreRole(subdomain);
  const { list, cats, currency } = await withTenant(store.storeId, async (tx) => ({
    list: await listProducts(tx, store.storeId, { q, status, categoryId: category, page: sp.page }),
    cats: await listCategories(tx, store.storeId),
    currency: await getStoreCurrency(tx, store.storeId),
  }));
  const base = `/dashboard/${subdomain}/products`;

  return (
    <div>
      <PageHeader
        title="Products"
        actions={access.dashboard === "full" && <ButtonLink href={`${base}/new`}>Add product</ButtonLink>}
      />
      {sp.deleted && <p className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Product deleted.</p>}

      <FilterTabs
        base={base}
        param="status"
        current={status}
        keep={{ q, category }}
        options={[
          { value: undefined, label: "All" },
          { value: "active", label: "Active" },
          { value: "draft", label: "Draft" },
          { value: "archived", label: "Archived" },
        ]}
      />
      <form className="mb-4 flex flex-wrap gap-2" action={base}>
        {status && <input type="hidden" name="status" value={status} />}
        <input
          name="q"
          defaultValue={q}
          placeholder="Search title or SKU"
          className="min-w-56 flex-1 rounded-lg border border-border bg-white px-3 py-2 text-sm"
        />
        <select name="category" defaultValue={category ?? ""} className="rounded-lg border border-border bg-white px-3 py-2 text-sm">
          <option value="">All categories</option>
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {"— ".repeat(c.depth)}
              {c.name}
            </option>
          ))}
        </select>
        <button className="rounded-lg border border-border bg-white px-4 py-2 text-sm hover:bg-slate-50">Filter</button>
      </form>

      <Table
        head={["", "Product", "Status", "Inventory", "Price", "Updated"]}
        empty={
          list.rows.length === 0 && (
            <EmptyState title={q || status || category ? "No products match these filters" : "No products yet"}>
              {!q && !status && !category && <Link href={`${base}/new`} className="text-brand hover:underline">Add your first product</Link>}
            </EmptyState>
          )
        }
      >
        {list.rows.map((p) => (
          <tr key={p.id} className="hover:bg-slate-50">
            <td className="w-14">
              <Thumb src={p.imageUrl} alt={p.title} />
            </td>
            <td>
              <Link href={`${base}/${p.id}`} className="font-medium hover:underline">
                {p.title}
              </Link>
              {p.variantCount > 1 && <div className="text-xs text-muted">{p.variantCount} variants</div>}
            </td>
            <td>
              <Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge>
            </td>
            <td className={p.stock !== null && p.stock <= 0 ? "text-red-600" : ""}>
              {p.stock === null ? <span className="text-muted">Not tracked</span> : `${p.stock} in stock`}
            </td>
            <td className="whitespace-nowrap">
              {p.minPrice === null
                ? "—"
                : p.minPrice === p.maxPrice
                  ? formatMoney(p.minPrice, currency)
                  : `${formatMoney(p.minPrice, currency)} – ${formatMoney(p.maxPrice!, currency)}`}
            </td>
            <td className="whitespace-nowrap text-muted">{p.updatedAt.toLocaleDateString("en-NG", { dateStyle: "medium" })}</td>
          </tr>
        ))}
      </Table>
      <Pagination base={base} page={list.page} pageCount={list.pageCount} total={list.total} params={{ q, status, category }} />
    </div>
  );
}
