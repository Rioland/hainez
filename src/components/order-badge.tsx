import { Badge } from "./ui";

const TONES = { pending: "warn", paid: "good", shipped: "neutral", delivered: "good", cancelled: "bad" } as const;

export function OrderStatusBadge({ status }: { status: keyof typeof TONES }) {
  return <Badge tone={TONES[status]}>{status}</Badge>;
}
