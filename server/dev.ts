/**
 * Dev server — roda Hono standalone na porta 8787.
 * Vite proxya /api → localhost:8787 (ver vite.config.ts).
 *
 * Em produção, este arquivo NÃO é usado — o Hono é deployado como
 * Vercel Function via api/[[...route]].ts.
 */
import "dotenv/config";
import { serve } from "@hono/node-server";
import { app } from "./app";

const port = Number(process.env.API_PORT ?? 8787);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[hono] API rodando em http://localhost:${info.port}/api`);
});
