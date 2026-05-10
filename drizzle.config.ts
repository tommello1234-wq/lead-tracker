import type { Config } from "drizzle-kit";
import { config as loadEnv } from "dotenv";

// Carrega .env.local primeiro (dev), depois .env (fallback). Mesmo padrão do server/dev.ts.
loadEnv({ path: ".env.local" });
loadEnv();

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";

export default {
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
} satisfies Config;
