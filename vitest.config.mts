import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  // `server-only` throws outside React Server Components; tests run in plain Node.
  "server-only": path.resolve(import.meta.dirname, "tests/helpers/empty.ts"),
};

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://msb_owner:msb_owner@localhost:5432/msb_test";

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/helpers/global-setup.ts"],
          // One DB, shared state: run files one after another.
          fileParallelism: false,
          env: {
            NODE_ENV: "test",
            DATABASE_URL: TEST_DATABASE_URL,
            TEST_DATABASE_URL,
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-000",
            ROUTING_MODE: "subdomain",
            ROOT_DOMAIN: "hainez.test",
          },
        },
      },
    ],
  },
});
