import { notFound } from "next/navigation";

// Unknown storefront paths render the store-branded 404 (inside the store layout).
export default function StorefrontCatchAll() {
  notFound();
}
