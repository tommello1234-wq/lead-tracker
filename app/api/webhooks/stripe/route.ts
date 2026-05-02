import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { eventos } from "@/db/schema";
import { parseStripeWebhook, verifyStripeSignature } from "@/lib/stripe";
import { handleGatewayEvent } from "@/lib/flows";
import { findOrCreateProdutoByName } from "@/lib/produtos";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();

  // 1) Valida assinatura ANTES de parsear (Stripe assina o body cru)
  const sig = verifyStripeSignature(rawBody, req.headers);
  if (!sig.valid) {
    await db.insert(eventos).values({
      source: "stripe",
      eventType: "signature_invalid",
      payload: { rawBody: rawBody.substring(0, 500), reason: sig.reason },
      processedOk: false,
      erro: sig.reason,
    });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // 2) Parse JSON
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    await db.insert(eventos).values({
      source: "stripe",
      eventType: "invalid_json",
      payload: { rawBody: rawBody.substring(0, 500) },
      processedOk: false,
      erro: "JSON invalido",
    });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // 3) Mapeia para evento interno
  const eventInput = parseStripeWebhook(event);
  if (!eventInput) {
    const stripeType = String((event as { type?: string }).type ?? "unknown");
    await db.insert(eventos).values({
      source: "stripe",
      eventType: stripeType,
      payload: event,
      processedOk: false,
      erro: "Tipo de evento nao mapeado",
    });
    // 200 pra Stripe nao reenviar — auditamos no DB.
    return NextResponse.json({ ok: false, reason: "unmapped-event", stripeType });
  }

  // 4) Identifica produto pelo nome (auto-cria se desconhecido)
  if (eventInput.planoNome) {
    const produto = await findOrCreateProdutoByName(eventInput.planoNome);
    if (produto) eventInput.produtoId = produto.id;
  }

  // 5) Processa via motor de fluxos
  try {
    const result = await handleGatewayEvent(eventInput);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const erro = e instanceof Error ? e.message : "Erro desconhecido";
    await db.insert(eventos).values({
      source: "stripe",
      eventType: eventInput.eventType,
      payload: event,
      processedOk: false,
      erro,
    });
    return NextResponse.json({ ok: false, error: erro }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "stripe-webhook",
    instructions:
      "POST teu webhook aqui. STRIPE_WEBHOOK_SIGNING_SECRET valida via header stripe-signature.",
  });
}
