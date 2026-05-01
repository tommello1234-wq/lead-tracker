import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL ou POSTGRES_URL nao definida. Configure no .env.local ou no painel da Vercel.",
  );
}

// `prepare: false` e necessario com pgbouncer (Neon transaction mode)
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
