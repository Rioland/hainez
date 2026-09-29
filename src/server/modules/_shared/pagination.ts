export const PAGE_SIZE = 20;

export type Page<T> = { rows: T[]; total: number; page: number; pageCount: number; pageSize: number };

export function pageParams(page: unknown, pageSize = PAGE_SIZE) {
  const n = Math.max(1, Math.min(10_000, Number.parseInt(String(page ?? "1"), 10) || 1));
  return { page: n, limit: pageSize, offset: (n - 1) * pageSize };
}

export function toPage<T>(rows: T[], total: number, page: number, pageSize = PAGE_SIZE): Page<T> {
  return { rows, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
