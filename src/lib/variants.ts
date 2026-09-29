/**
 * Product options -> variant combinations. Shared by the product editor
 * (client) and product validation (server).
 */

export type ProductOption = { name: string; values: string[] };
export type OptionValues = Record<string, string>;

export const MAX_OPTIONS = 3;
export const MAX_VALUES_PER_OPTION = 30;
export const MAX_VARIANTS = 100;

/** All combinations, in option order: Size [S,M] x Colour [Red] -> [{Size:S,Colour:Red},{Size:M,Colour:Red}] */
export function combinations(options: ProductOption[]): OptionValues[] {
  const usable = options.filter((o) => o.name.trim() && o.values.length > 0);
  if (usable.length === 0) return [{}];
  return usable.reduce<OptionValues[]>(
    (acc, opt) => acc.flatMap((combo) => opt.values.map((v) => ({ ...combo, [opt.name]: v }))),
    [{}],
  );
}

/** Stable key for a combination, independent of object key order. */
export function variantKey(options: ProductOption[], values: OptionValues): string {
  return options.map((o) => `${o.name}=${values[o.name] ?? ""}`).join("|");
}

/** "M / Red" (or "Default" for a product without options). */
export function variantTitle(options: ProductOption[], values: OptionValues): string {
  const parts = options.map((o) => values[o.name]).filter(Boolean);
  return parts.length ? parts.join(" / ") : "Default";
}
