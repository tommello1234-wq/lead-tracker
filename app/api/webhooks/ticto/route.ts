import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { eventos } from "@/db/schema";
import { parseTictoWebhook, verifyTictoSignature } from "@/lib/ticto";
import { handleGatewayEvent } from "@/lib/flows";
import { findOrCreateProdutoByName } from "@/lib/produtos";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const rawBody = await req.text();

  // 1) Parse JSON (precisa vir antes — a Ticto manda o token DENTRO do body)
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    await db.insert(eventos).values({
      source: "ticto",
      eventType: "invalid_json",
      payload: { rawBody },
      processedOk: false,
      erro: "JSON invalido",
    });
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  // 2) Valida o token de seguranca da Ticto (campo `token` no body)
  const sig = verifyTictoSignature(payload);
  if (!sig.valid) {
    await db.insert(eventos).values({
      source: "ticto",
      eventType: "signature_invalid",
      payload: { rawBody, reason: sig.reason },
      processedOk: false,
      erro: sig.reason,
    });
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  // 3) Mapeia para evento interno
  const event = parseTictoWebhook(payload);
  if (!event) {
    await db.insert(eventos).values({
      source: "ticto",
      eventType: "unknown",
      payload,
      processedOk: false,
      erro: "Tipo de evento nao reconhecido",
    });
    // Retorna 200 pra Ticto nao reenviar — investigamos no DB depois.
    return NextResponse.json({ ok: false, reason: "unknown-event" });
  }

  // 4) Identifica produto pelo nome (auto-cria se desconhecido)
  if (event.planoNome) {
    // Tenta extrair "Gravyx" de "Gravyx Creator" → busca produto pai;
    // se for um produto totalmente novo, cria com tipo "indefinido"
    const produto = await findOrCreateProdutoByName(event.planoNome);
    if (produto) event.produtoId = produto.id;
  }

  // 5) Processa via motor de fluxos
  try {
    const result = await handleGatewayEvent(event);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const erro = e instanceof Error ? e.message : "Erro desconhecido";
    await db.insert(eventos).values({
      source: "ticto",
      eventType: event.eventType,
      payload,
      processedOk: false,
      erro,
    });
    return NextResponse.json({ ok: false, error: erro }, { status: 500 });
  }
}

// Health check
export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: "ticto-webhook",
    instructions:
      "POST teu webhook aqui. Configure TICTO_WEBHOOK_SECRET pra validacao em producao.",
  });
}
