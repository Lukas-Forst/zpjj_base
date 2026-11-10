// npm run seed -- [--users seed/users.local.yaml] > seed.sql
import { existsSync, readFileSync } from "node:fs";
import { parse } from "yaml";
import { buildSeedSql, type SeedUser } from "../src/seedSql";

const arg = process.argv.indexOf("--users");
const file = arg > 0 ? process.argv[arg + 1] : existsSync("seed/users.local.yaml") ? "seed/users.local.yaml" : "seed/users.example.yaml";
try {
  if (!existsSync(file)) throw new Error(`Missing ${file}. Copy users.example.yaml to users.local.yaml and edit.`);
  const entries = (parse(readFileSync(file, "utf8")) ?? {}).users ?? [];
  const users: SeedUser[] = entries.map((e: Record<string, unknown>) => ({
    email: String(e.email), display_name: String(e.display_name), role: e.role as SeedUser["role"], is_trainer: Boolean(e.is_trainer ?? false),
  }));
  process.stdout.write(buildSeedSql(users));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
