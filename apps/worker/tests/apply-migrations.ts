import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";

// Idempotent: only applies migrations that are not yet applied.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
