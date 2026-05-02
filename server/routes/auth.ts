import { Hono } from "hono";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import { z } from "zod";
import { expectedToken, SESSION_COOKIE } from "../lib/auth";

export const authRoutes = new Hono();

const loginSchema = z.object({
  password: z.string().min(1),
});

/**
 * POST /api/auth/login
 * Body: { password: string }
 * Response: { ok: true } + Set-Cookie httpOnly
 */
authRoutes.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Senha obrigatória" }, 400);
  }

  const expectedPassword = process.env.APP_PASSWORD ?? "";
  if (parsed.data.password !== expectedPassword) {
    return c.json({ error: "Senha incorreta" }, 401);
  }

  setCookie(c, SESSION_COOKIE, expectedToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 dias
  });

  return c.json({ ok: true });
});

/**
 * POST /api/auth/logout
 * Limpa o cookie e retorna ok.
 */
authRoutes.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/**
 * GET /api/auth/me
 * Verifica se está autenticado (usado pelo frontend pra montar contexto).
 * Não usa requireAuth porque queremos retornar 200 com { authenticated: false }
 * em vez de 401.
 */
authRoutes.get("/me", (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  return c.json({ authenticated: token === expectedToken() });
});
