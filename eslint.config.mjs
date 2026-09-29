import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Tenant-isolation guardrail: the PLATFORM connection bypasses row-level
 * security, so only these places may import it. Everything store-scoped must
 * use withTenant() from "@/server/db/tenant".
 */
const PLATFORM_DB_ALLOWED = [
  "src/server/db/**",
  "src/server/tenancy/**",
  "src/server/auth/**",
  "src/server/modules/superadmin/**",
  "src/server/modules/billing/**", // Stage 6: subscription state machine
  "src/server/payments/**/webhooks/**", // Stage 6-7: provider webhooks
  "src/server/jobs/**", // background jobs
  "scripts/**",
  "tests/**",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: PLATFORM_DB_ALLOWED,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              regex: "(^@/server/db/platform$)|(/db/platform$)",
              message:
                "The platform DB connection bypasses row-level security. Use withTenant() from @/server/db/tenant, or move this code into an allowlisted module (see eslint.config.mjs).",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "drizzle/**"]),
]);

export default eslintConfig;
