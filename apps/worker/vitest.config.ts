import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { ENV: "test", TEST_MIGRATIONS: migrations },
          // Ruling A: tests never depend on apps/web/out
          assets: { directory: path.join(import.meta.dirname, "tests/assets"), binding: "ASSETS" },
        },
      }),
    ],
    test: { setupFiles: ["./tests/apply-migrations.ts"] },
  };
});
