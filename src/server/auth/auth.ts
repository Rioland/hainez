import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { platformDb } from "../db/platform";
import { authAccounts, authSessions, authVerifications, users } from "../db/schema";
import { env } from "../env";

/**
 * Hosts allowed to serve platform auth (/api/auth/*). Store hosts are never
 * allowed: the proxy 404s /api/* there, and Better Auth rejects unknown hosts.
 */
function platformAuthHosts(): string[] {
  const root = env.ROOT_DOMAIN;
  if (env.ROUTING_MODE === "subdomain") return [`app.${root}`, `admin.${root}`];
  const hosts = [root];
  // Vercel preview/branch URLs of this project, when running on Vercel.
  for (const h of [process.env.VERCEL_URL, process.env.VERCEL_BRANCH_URL]) if (h) hosts.push(h);
  if (env.NODE_ENV !== "production") hosts.push("localhost:3000", "127.0.0.1:3000");
  return hosts;
}

const protocol = env.USE_HTTPS ? "https" : "http";

export const auth = betterAuth({
  appName: env.PLATFORM_NAME,
  secret: env.BETTER_AUTH_SECRET,
  // One app, several platform hosts (app. and admin.); each gets its own host-only cookie.
  baseURL: {
    allowedHosts: platformAuthHosts(),
    protocol,
  },
  trustedOrigins: platformAuthHosts().map((h) => `${protocol}://${h}`),

  database: drizzleAdapter(platformDb, {
    provider: "pg",
    schema: {
      user: users,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
    },
  }),

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: true,
    // Turned on in Stage 10 once transactional email is wired up.
    requireEmailVerification: false,
  },

  user: {
    additionalFields: {
      // input:false -> can never be set from sign-up/update requests.
      platformRole: { type: "string", required: false, defaultValue: "user", input: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 14, // 14 days
    updateAge: 60 * 60 * 24, // refresh expiry at most once a day
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
      "/sign-up/email": { window: 60, max: 3 },
    },
    // In-memory for now (per instance). Moves to Redis/Upstash in Stage 10.
  },

  advanced: {
    cookiePrefix: "msb",
    useSecureCookies: env.USE_HTTPS,
    // Let Postgres generate UUID v7 ids (uuid_generate_v7() column default).
    database: { generateId: false },
  },

  // Lets server actions set auth cookies.
  plugins: [nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
