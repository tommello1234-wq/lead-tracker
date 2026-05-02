/**
 * Vercel Function entry — captura todas as rotas /api/* e delega pro Hono.
 *
 * Em produção, este arquivo é o único endpoint server. O Hono mounta tudo em
 * /api/* internamente (ver server/app.ts).
 */
import { app } from "../server/app";

export const config = {
  runtime: "nodejs",
};

export default async function handler(req: Request): Promise<Response> {
  return app.fetch(req);
}
