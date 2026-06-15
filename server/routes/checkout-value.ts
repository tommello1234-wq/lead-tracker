import { Hono } from "hono";

/**
 * Valor real pago de um Checkout Session do Stripe.
 * Rota PÚBLICA (chamada pelo browser na /obrigado) — sem requireAuth.
 *
 * Motivo: o success_url do Payment Link tem `?value=97` FIXO (Stripe não passa
 * o amount pago na URL). Em venda com cupom (ex: 40% off = R$ 58,20), o Pixel
 * browser mandaria 97 e inflaria o ROAS no Meta. Aqui o /obrigado busca o valor
 * REAL (amount_total) antes de disparar o Purchase, casando com o CAPI server-side.
 */
export const checkoutValueRoutes = new Hono();

checkoutValueRoutes.get("/", async (c) => {
  const sessionId = c.req.query("session_id");

  // Valida formato (Stripe Checkout Session = cs_...). Evita bater na API com lixo.
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return c.json({ error: "session_id inválido" }, 400);
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return c.json({ error: "STRIPE_SECRET_KEY ausente" }, 500);

  try {
    const res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
      { headers: { Authorization: `Bearer ${key}` } },
    );

    if (!res.ok) {
      // Session não encontrada / chave errada — o front cai no fallback (value da URL).
      return c.json({ error: "session não encontrada" }, res.status === 404 ? 404 : 502);
    }

    const session = (await res.json()) as {
      amount_total?: number | null;
      currency?: string | null;
    };

    // amount_total vem em centavos. Se nulo (session aberta sem total), o front usa fallback.
    if (typeof session.amount_total !== "number") {
      return c.json({ error: "amount_total ausente" }, 422);
    }

    return c.json({
      value: session.amount_total / 100,
      currency: (session.currency ?? "brl").toUpperCase(),
    });
  } catch {
    return c.json({ error: "falha ao consultar Stripe" }, 502);
  }
});
