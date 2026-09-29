import { notFound } from "next/navigation";

// Unknown platform paths render the platform-branded 404.
export default function PlatformCatchAll() {
  notFound();
}
