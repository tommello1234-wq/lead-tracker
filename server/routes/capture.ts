import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { eventos } from "../../db/schema.js";
import { handleGatewayEvent } from "../lib/flows.js";
import { normalizePhone } from "../lib/evolution.js";

/**
 * Captura de lead do pop-up de checkout (LP gravyx.com.br).
 * Rota PÚBLICA (chamada pelo browser) — sem requireAuth.
 *
 * Fluxo: pessoa preenche Nome/Email/WhatsApp no pop-up antes de ir pro Stripe.
 * Aqui a gente cria o lead e dispara o fluxo `carrinho_abandonado`. Se ela
 * comprar depois, o webhook `compra_aprovada` cancela o carrinho pendente
 * automaticamente (EVENT_CANCELS). Se não comprar, recebe as mensagens.
 */
export const captureRoutes = new Hono();

// Teto diário de carrinhos disparados — proteção anti-ban do número Evolution.
// Acima disso, o lead é capturado (fica no CRM) mas NÃO recebe mensagem.
const CART_DAILY_CAP = 30;

captureRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const nome = String(body.nome ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const whatsDigits = String(body.whatsapp ?? "").replace(/\D/g, "");
  const plano = String(body.plano ?? "").trim() || null;
  const lp = String(body.lp ?? "").trim() || null;

  // Validação básica (espelha a do pop-up; evita lixo)
  if (nome.length < 2) return c.json({ error: "nome inválido" }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return c.json({ error: "email inválido" }, 400);
  if (whatsDigits.length < 10) return c.json({ error: "whatsapp inválido" }, 400);

  const contato = normalizePhone(whatsDigits);

  // Teto: leads distintos com carrinho agendado hoje (BRT). Aproximado — não
  // precisa ser exato, é só uma trava de volume.
  const cnt = await db.execute(sql`
    SELECT count(DISTINCT lead_id) AS n FROM mensagens_agendadas
    WHERE template LIKE 'carrinho_abandonado%'
      AND criado_em AT TIME ZONE 'America/Sao_Paulo'
        >= date_trunc('day', NOW() AT TIME ZONE 'America/Sao_Paulo')
  `);
  const cntRows = cnt as unknown as Array<{ n: number | string }>;
  const usados = Number(cntRows[0]?.n ?? 0);
  const acimaDoTeto = usados >= CART_DAILY_CAP;

  try {
    const result = await handleGatewayEvent({
      source: "popup",
      eventType: "carrinho_abandonado",
      rawPayload: body,
      nome,
      email,
      contato,
      planoNome: plano,
      extras: lp ? { lp } : undefined,
      skipScheduling: acimaDoTeto,
    });

    // Audit no feed
    await db.insert(eventos).values({
      leadId: result.leadId > 0 ? result.leadId : null,
      source: "popup",
      eventType: "carrinho_abandonado",
      payload: body as object,
      processedOk: true,
      erro: acimaDoTeto
        ? `Teto diário (${CART_DAILY_CAP}) atingido — lead capturado sem disparo`
        : null,
    });

    return c.json({ ok: true, scheduled: result.scheduledMessages > 0 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.insert(eventos).values({
      source: "popup",
      eventType: "carrinho_abandonado",
      payload: body as object,
      processedOk: false,
      erro: msg,
    });
    return c.json({ ok: false, error: "Falha ao processar" }, 500);
  }
});
