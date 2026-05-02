import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { isValidToken, SESSION_COOKIE } from "../lib/auth";

/**
 * Middleware Hono pra proteger rotas. 401 se cookie de sessão inválido.
 * Use em rotas que requerem auth: app.use("/api/leads/*", requireAuth)
 */
export const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!isValidToken(token)) {
    return c.json({ error: "Não autenticado" }, 401);
  }
  await next();
};
