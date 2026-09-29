"use client";

import { useActionState, useMemo, useState } from "react";
import { Checkbox, Field, FormMessage, Input, MoneyInput, Select, SubmitButton, Textarea } from "@/components/form";
import { Button, Card } from "@/components/ui";
import { useActionRedirect } from "@/components/use-action-redirect";
import { minorToInput, parseMoney } from "@/lib/money";
import { slugify } from "@/lib/slug";
import {
  combinations,
  MAX_OPTIONS,
  variantKey,
  variantTitle,
  type OptionValues,
  type ProductOption,
} from "@/lib/variants";
import { ImageManager, type ProductImage } from "./image-manager";

type ActionState = { ok: true; message?: string; redirectTo?: string } | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> } | null;
type UploadResult<T> = { ok: true; data?: T } | { ok: false; error: string } | null;

export type ProductFormInitial = {
  title: string;
  slug: string;
  description: string;
  status: "draft" | "active" | "archived";
  isFeatured: boolean;
  seoTitle: string;
  seoDescription: string;
  categoryIds: string[];
  options: ProductOption[];
  variants: {
    id: string;
    optionValues: OptionValues;
    priceMinor: number;
    compareAtPriceMinor: number | null;
    sku: string | null;
    stockQuantity: number;
    trackInventory: boolean;
    allowBackorder: boolean;
  }[];
  images: ProductImage[];
};

type VariantRow = {
  id?: string;
  include: boolean;
  price: string;
  compareAt: string;
  sku: string;
  stock: string;
  trackInventory: boolean;
  allowBackorder: boolean;
};

type OptionDraft = { name: string; values: string };

const emptyRow = (price = ""): VariantRow => ({
  include: true,
  price,
  compareAt: "",
  sku: "",
  stock: "0",
  trackInventory: true,
  allowBackorder: false,
});

const toOptions = (drafts: OptionDraft[]): ProductOption[] =>
  drafts
    .map((d) => ({
      name: d.name.trim(),
      values: [...new Set(d.values.split(",").map((v) => v.trim()).filter(Boolean))],
    }))
    .filter((o) => o.name && o.values.length);

type ProductFormProps = {
  initial: ProductFormInitial;
  /** Changes whenever the saved product changes (e.g. its updatedAt): resets the editor to fresh server data. */
  version: string;
  categories: { id: string; name: string; depth: number }[];
  currency: string;
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  requestUpload: (input: { contentType: string; size: number }) => Promise<UploadResult<{ key: string; url: string; headers: Record<string, string> }>>;
  confirmUpload: (input: { key: string }) => Promise<UploadResult<{ id: string; url: string }>>;
  readOnly?: boolean;
};

/**
 * Holds the action state OUTSIDE the keyed editor: after a save the server
 * re-renders with fresh data (new variant ids), the editor remounts, and the
 * result/redirect still survives here.
 */
export function ProductForm({ action, version, ...props }: ProductFormProps) {
  const [state, formAction] = useActionState(action, null);
  useActionRedirect(state);
  return <ProductEditor key={version} {...props} state={state} formAction={formAction} />;
}

function ProductEditor({
  initial,
  categories,
  currency,
  requestUpload,
  confirmUpload,
  readOnly,
  state,
  formAction,
}: Omit<ProductFormProps, "action" | "version"> & { state: ActionState; formAction: (formData: FormData) => void }) {
  const fieldErrors = state && !state.ok ? state.fieldErrors ?? {} : {};

  const [title, setTitle] = useState(initial.title);
  const [slug, setSlug] = useState(initial.slug);
  const [description, setDescription] = useState(initial.description);
  const [status, setStatus] = useState(initial.status);
  const [isFeatured, setFeatured] = useState(initial.isFeatured);
  const [seoTitle, setSeoTitle] = useState(initial.seoTitle);
  const [seoDescription, setSeoDescription] = useState(initial.seoDescription);
  const [categoryIds, setCategoryIds] = useState<string[]>(initial.categoryIds);
  const [images, setImages] = useState<ProductImage[]>(initial.images);
  const [optionDrafts, setOptionDrafts] = useState<OptionDraft[]>(
    initial.options.map((o) => ({ name: o.name, values: o.values.join(", ") })),
  );

  // Variant rows keyed by their option combination, so editing options keeps
  // the price/stock already typed for combinations that still exist.
  const [rows, setRows] = useState<Record<string, VariantRow>>(() => {
    const out: Record<string, VariantRow> = {};
    for (const v of initial.variants) {
      out[variantKey(initial.options, v.optionValues)] = {
        id: v.id,
        include: true,
        price: minorToInput(v.priceMinor),
        compareAt: minorToInput(v.compareAtPriceMinor),
        sku: v.sku ?? "",
        stock: String(v.stockQuantity),
        trackInventory: v.trackInventory,
        allowBackorder: v.allowBackorder,
      };
    }
    return out;
  });

  const options = useMemo(() => toOptions(optionDrafts), [optionDrafts]);
  const combos = useMemo(() => combinations(options), [options]);
  const firstPrice = Object.values(rows)[0]?.price ?? "";
  const rowFor = (values: OptionValues) => rows[variantKey(options, values)] ?? emptyRow(firstPrice);
  const updateRow = (values: OptionValues, patch: Partial<VariantRow>) =>
    setRows((r) => ({ ...r, [variantKey(options, values)]: { ...rowFor(values), ...patch } }));

  // Build the JSON payload the server validates (money converted to minor units).
  // Recomputed every render: cheap (at most 100 variants) and always in sync.
  const { payload, problems } = (() => {
    const problems: string[] = [];
    const variants = combos
      .map((values) => ({ values, row: rows[variantKey(options, values)] ?? emptyRow(firstPrice) }))
      .filter(({ row }) => row.include)
      .map(({ values, row }) => {
        const label = variantTitle(options, values);
        const priceMinor = parseMoney(row.price);
        const compare = row.compareAt.trim() ? parseMoney(row.compareAt) : null;
        const stock = Number.parseInt(row.stock || "0", 10);
        if (priceMinor === null) problems.push(`${label}: enter a valid price`);
        if (row.compareAt.trim() && compare === null) problems.push(`${label}: enter a valid compare-at price`);
        if (!Number.isFinite(stock)) problems.push(`${label}: enter a whole number for stock`);
        return {
          id: row.id,
          optionValues: values,
          priceMinor: priceMinor ?? 0,
          compareAtPriceMinor: compare,
          sku: row.sku.trim() || null,
          stockQuantity: Number.isFinite(stock) ? stock : 0,
          trackInventory: row.trackInventory,
          allowBackorder: row.allowBackorder,
        };
      });
    if (variants.length === 0) problems.push("Include at least one variant");
    return {
      problems,
      payload: JSON.stringify({
        title,
        slug,
        description,
        status,
        isFeatured,
        seoTitle,
        seoDescription,
        categoryIds,
        options,
        variants,
        images: images.map((i) => ({ mediaId: i.mediaId, alt: i.alt })),
      }),
    };
  })();

  const hasOptions = options.length > 0;
  const single = combos[0];

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      <fieldset disabled={readOnly} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-6">
            <Card className="space-y-4">
              <Field label="Title" error={fieldErrors.title}>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} placeholder="e.g. Ankara wrap dress" />
              </Field>
              <Field label="Description" error={fieldErrors.description}>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} maxLength={20000} />
              </Field>
            </Card>

            <Card>
              <h2 className="mb-3 font-medium">Images</h2>
              <ImageManager images={images} onChange={setImages} requestUpload={requestUpload} confirmUpload={confirmUpload} disabled={readOnly} />
            </Card>

            <Card className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-medium">Options</h2>
                {optionDrafts.length < MAX_OPTIONS && (
                  <Button type="button" variant="secondary" onClick={() => setOptionDrafts((d) => [...d, { name: d.length ? "Colour" : "Size", values: "" }])}>
                    + Add option
                  </Button>
                )}
              </div>
              {optionDrafts.length === 0 && <p className="text-sm text-muted">Add options like size or colour if this product comes in variations.</p>}
              {optionDrafts.map((d, i) => (
                <div key={i} className="grid gap-3 sm:grid-cols-[160px_1fr_auto]">
                  <Input value={d.name} onChange={(e) => setOptionDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Option name" aria-label="Option name" />
                  <Input
                    value={d.values}
                    onChange={(e) => setOptionDrafts((ds) => ds.map((x, j) => (j === i ? { ...x, values: e.target.value } : x)))}
                    placeholder="Values, comma separated: S, M, L"
                    aria-label="Option values"
                  />
                  <Button type="button" variant="ghost" onClick={() => setOptionDrafts((ds) => ds.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                </div>
              ))}
              {fieldErrors.options && <p className="text-xs text-red-600">{fieldErrors.options[0]}</p>}
            </Card>

            <Card className="space-y-4">
              <h2 className="font-medium">{hasOptions ? `Variants (${combos.length})` : "Pricing & inventory"}</h2>
              {!hasOptions ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Price">
                    <MoneyInput currency={currency} value={rowFor(single).price} onChange={(e) => updateRow(single, { price: e.target.value })} placeholder="0.00" />
                  </Field>
                  <Field label="Compare-at price" hint="Original price, shown struck through">
                    <MoneyInput currency={currency} value={rowFor(single).compareAt} onChange={(e) => updateRow(single, { compareAt: e.target.value })} placeholder="Optional" />
                  </Field>
                  <Field label="SKU">
                    <Input value={rowFor(single).sku} onChange={(e) => updateRow(single, { sku: e.target.value })} maxLength={64} placeholder="Optional" />
                  </Field>
                  <Field label="Stock">
                    <Input type="number" value={rowFor(single).stock} onChange={(e) => updateRow(single, { stock: e.target.value })} disabled={!rowFor(single).trackInventory} />
                  </Field>
                  <div className="flex flex-wrap gap-4 sm:col-span-2">
                    <Checkbox label="Track stock" checked={rowFor(single).trackInventory} onChange={(e) => updateRow(single, { trackInventory: e.target.checked })} />
                    <Checkbox label="Allow orders when out of stock" checked={rowFor(single).allowBackorder} onChange={(e) => updateRow(single, { allowBackorder: e.target.checked })} />
                  </div>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="text-left text-xs uppercase text-muted">
                      <tr>
                        <th className="py-2">Variant</th>
                        <th>Price</th>
                        <th>Compare-at</th>
                        <th>SKU</th>
                        <th>Stock</th>
                        <th>Track</th>
                      </tr>
                    </thead>
                    <tbody>
                      {combos.map((values) => {
                        const row = rowFor(values);
                        const label = variantTitle(options, values);
                        return (
                          <tr key={variantKey(options, values)} className={`border-t border-border ${row.include ? "" : "opacity-40"}`}>
                            <td className="whitespace-nowrap py-2 pr-2">
                              <Checkbox label={label} checked={row.include} onChange={(e) => updateRow(values, { include: e.target.checked })} />
                            </td>
                            <td className="pr-2">
                              <MoneyInput currency={currency} className="w-32" value={row.price} onChange={(e) => updateRow(values, { price: e.target.value })} aria-label={`${label} price`} />
                            </td>
                            <td className="pr-2">
                              <MoneyInput currency={currency} className="w-32" value={row.compareAt} onChange={(e) => updateRow(values, { compareAt: e.target.value })} aria-label={`${label} compare-at price`} />
                            </td>
                            <td className="pr-2">
                              <Input className="w-28" value={row.sku} onChange={(e) => updateRow(values, { sku: e.target.value })} aria-label={`${label} SKU`} />
                            </td>
                            <td className="pr-2">
                              <Input className="w-20" type="number" value={row.stock} disabled={!row.trackInventory} onChange={(e) => updateRow(values, { stock: e.target.value })} aria-label={`${label} stock`} />
                            </td>
                            <td>
                              <input type="checkbox" checked={row.trackInventory} onChange={(e) => updateRow(values, { trackInventory: e.target.checked })} aria-label={`${label} track stock`} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-muted">Untick a variant you don&apos;t sell. New variants start at the first variant&apos;s price.</p>
                </div>
              )}
              {fieldErrors.variants && <p className="text-xs text-red-600">{fieldErrors.variants[0]}</p>}
            </Card>

            <Card className="space-y-4">
              <h2 className="font-medium">Search engine listing</h2>
              <Field label="URL handle" hint={`Leave empty to use "${slugify(title) || "product"}"`} error={fieldErrors.slug}>
                <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} maxLength={80} placeholder={slugify(title)} />
              </Field>
              <Field label="Page title" error={fieldErrors.seoTitle}>
                <Input value={seoTitle} onChange={(e) => setSeoTitle(e.target.value)} maxLength={70} placeholder={title} />
              </Field>
              <Field label="Meta description" error={fieldErrors.seoDescription}>
                <Textarea value={seoDescription} onChange={(e) => setSeoDescription(e.target.value)} maxLength={320} rows={3} />
              </Field>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="space-y-4">
              <Field label="Status">
                <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
                  <option value="draft">Draft (hidden)</option>
                  <option value="active">Active (visible in store)</option>
                  <option value="archived">Archived</option>
                </Select>
              </Field>
              <Checkbox label="Feature on home page" checked={isFeatured} onChange={(e) => setFeatured(e.target.checked)} />
            </Card>
            <Card>
              <h2 className="mb-3 font-medium">Categories</h2>
              {categories.length === 0 ? (
                <p className="text-sm text-muted">No categories yet.</p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {categories.map((c) => (
                    <div key={c.id} style={{ paddingLeft: c.depth * 16 }}>
                      <Checkbox
                        label={c.name}
                        checked={categoryIds.includes(c.id)}
                        onChange={(e) => setCategoryIds((ids) => (e.target.checked ? [...ids, c.id] : ids.filter((x) => x !== c.id)))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </div>
      </fieldset>

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-slate-50/95 px-4 py-3 backdrop-blur">
        <SubmitButton disabled={readOnly || problems.length > 0}>Save product</SubmitButton>
        {problems.length > 0 && <span className="text-sm text-red-600">{problems[0]}</span>}
        <div className="flex-1">
          <FormMessage state={state} />
        </div>
      </div>
    </form>
  );
}
