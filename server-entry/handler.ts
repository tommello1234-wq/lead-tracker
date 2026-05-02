/**
 * Vercel Function entry — captura todas as rotas /api/* e delega pro Hono.
 *
 * Em produção, este arquivo é bundlado pelo esbuild em api/[[...route]].js
 * e funciona como Vercel Function (Node runtime).
 *
 * O `handle` do Hono cuida da conversão entre o req/res do Vercel Node
 * runtime e o fetch handler do Hono.
 */
import { handle } from "hono/vercel";
import { app } from "../server/app.js";

export const config = {
  runtime: "nodejs",
};

export default handle(app);
