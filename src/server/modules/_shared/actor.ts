import type { StoreRole } from "../../auth/memberships";

/** Who is doing something to a store. Passed to services for auditing. */
export type StoreActor = {
  storeId: string;
  userId: string;
  role: StoreRole;
  /** Set when a super admin is impersonating the user (Stage 9). */
  impersonatorId?: string | null;
  ip: string | null;
  userAgent: string | null;
};

/** Actor for scripts/tests/background jobs. */
export function systemActor(storeId: string, userId: string): StoreActor {
  return { storeId, userId, role: "owner", ip: null, userAgent: "system" };
}
