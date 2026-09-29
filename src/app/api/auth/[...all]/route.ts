import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/server/auth/auth";

// Platform auth endpoints (sign-up, sign-in, sign-out, session).
// The proxy only lets /api/* through on platform hosts, never on store hosts.
export const { GET, POST } = toNextJsHandler(auth);
