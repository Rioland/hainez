import { boolean, index, inet, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { citext, createdAt, id, updatedAt } from "./_shared";
import { platformRole } from "./enums";

/*
 * Platform identity tables, shaped for Better Auth's Drizzle adapter.
 * Property names (camelCase) are what Better Auth expects; column names are snake_case.
 * These are platform-level (no RLS) and only touched via the platform connection.
 *
 * Store customers are NOT here: they live in `customers` (Stage 3), scoped per store.
 */

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: citext("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  platformRole: platformRole("platform_role").notNull().default("user"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    /** Set when a super admin impersonates this user for support (Stage 9). */
    impersonatedBy: uuid("impersonated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_sessions_user_idx").on(t.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "credential" for email + password. */
    providerId: text("provider_id").notNull(),
    accountId: text("account_id").notNull(),
    /** Password hash (scrypt, managed by Better Auth). Never plain text. */
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_accounts_user_idx").on(t.userId)],
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: id(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("auth_verifications_identifier_idx").on(t.identifier)],
);
