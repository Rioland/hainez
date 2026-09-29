/**
 * Money is stored as integer minor units (kobo for NGN). These helpers convert
 * between what people type ("15,000.50") and what we store (1500050).
 * Shared by client and server.
 */

export const SUPPORTED_CURRENCIES = ["NGN", "GHS", "KES", "ZAR", "USD"] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];

/** "15,000.5" -> 1500050. Returns null for anything that isn't a valid non-negative amount. */
export function parseMoney(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  const text = String(input).replace(/[,\s₦$]/g, "").trim();
  if (text === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, frac = ""] = text.split(".");
  const minor = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(minor) ? minor : null;
}

/** 1500050 -> "15000.50" (for form inputs). */
export function minorToInput(minor: number | null | undefined): string {
  if (minor === null || minor === undefined) return "";
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 1500050, "NGN" -> "₦15,000.50" */
export function formatMoney(minor: number, currency: string = "NGN"): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: minor % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}
