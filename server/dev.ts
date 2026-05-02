/**
 * Dev server — roda Hono standalone na porta 8787.
 * Vite proxya /api → localhost:8787 (ver vite.config.ts).
 *
 * IMPORTANTE: dotenv carrega ANTES do dynamic import do start.ts.
 * Em ESM, top-level imports são hoisted/evaluados em paralelo — então tem
 * que separar pra forçar ordem (env primeiro, depois import do app que
 * lê process.env.DATABASE_URL).
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local" });
loadEnv();

await import("./start");
