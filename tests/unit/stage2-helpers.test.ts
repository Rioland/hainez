import { describe, expect, it } from "vitest";
import { formatMoney, minorToInput, parseMoney } from "@/lib/money";
import { slugify } from "@/lib/slug";
import { combinations, variantKey, variantTitle } from "@/lib/variants";
import { matchesImageSignature } from "@/lib/images";
import { canTransition, commitsInventory } from "@/server/modules/orders/transitions";

describe("money", () => {
  it("parses what people type into kobo", () => {
    expect(parseMoney("15,000.50")).toBe(1_500_050);
    expect(parseMoney("₦ 2,500")).toBe(250_000);
    expect(parseMoney("0.5")).toBe(50);
    expect(parseMoney("12")).toBe(1200);
    for (const bad of ["", "abc", "1.234", "-5", "1e5", null, undefined]) expect(parseMoney(bad)).toBeNull();
  });
  it("round-trips through form inputs and formats as currency", () => {
    expect(minorToInput(1_500_050)).toBe("15000.50");
    expect(minorToInput(null)).toBe("");
    expect(formatMoney(1_850_000, "NGN")).toBe("₦18,500");
    expect(formatMoney(1_850_050, "NGN")).toBe("₦18,500.50");
  });
});

describe("slugify", () => {
  it("makes URL-safe handles", () => {
    expect(slugify("Men's Red Shoes (2026)!")).toBe("mens-red-shoes-2026");
    expect(slugify("  Àdìrẹ  Tie-Dye ")).toBe("adire-tie-dye");
    expect(slugify("***")).toBe("");
  });
});

describe("variants", () => {
  const opts = [
    { name: "Size", values: ["S", "M"] },
    { name: "Colour", values: ["Red"] },
  ];
  it("builds every combination in option order", () => {
    expect(combinations(opts)).toEqual([
      { Size: "S", Colour: "Red" },
      { Size: "M", Colour: "Red" },
    ]);
    expect(combinations([])).toEqual([{}]);
  });
  it("keys and titles are stable regardless of object key order", () => {
    expect(variantKey(opts, { Colour: "Red", Size: "M" })).toBe(variantKey(opts, { Size: "M", Colour: "Red" }));
    expect(variantTitle(opts, { Colour: "Red", Size: "M" })).toBe("M / Red");
    expect(variantTitle([], {})).toBe("Default");
  });
});

describe("order transitions", () => {
  it("allows the normal flow and blocks going backwards", () => {
    expect(canTransition("pending", "paid")).toBe(true);
    expect(canTransition("pending", "shipped")).toBe(true); // pay on delivery
    expect(canTransition("paid", "shipped")).toBe(true);
    expect(canTransition("shipped", "delivered")).toBe(true);
    expect(canTransition("shipped", "pending")).toBe(false);
    expect(canTransition("delivered", "cancelled")).toBe(false);
    expect(canTransition("cancelled", "paid")).toBe(false);
    expect(commitsInventory("paid") && commitsInventory("shipped") && !commitsInventory("delivered")).toBe(true);
  });
});

describe("image signatures", () => {
  const bytes = (...b: number[]) => Uint8Array.from(b);
  const ascii = (s: string) => new TextEncoder().encode(s);
  it("recognises real image headers", () => {
    expect(matchesImageSignature(bytes(0xff, 0xd8, 0xff, 0xe0), "image/jpeg")).toBe(true);
    expect(matchesImageSignature(bytes(0x89, 0x50, 0x4e, 0x47), "image/png")).toBe(true);
    expect(matchesImageSignature(ascii("GIF89a"), "image/gif")).toBe(true);
    expect(matchesImageSignature(ascii("RIFF\0\0\0\0WEBPVP8 "), "image/webp")).toBe(true);
    expect(matchesImageSignature(ascii("\0\0\0\x1cftypavif"), "image/avif")).toBe(true);
  });
  it("rejects files pretending to be images", () => {
    expect(matchesImageSignature(ascii("<html><script>"), "image/png")).toBe(false);
    expect(matchesImageSignature(bytes(0x89, 0x50, 0x4e, 0x47), "image/jpeg")).toBe(false);
  });
});
