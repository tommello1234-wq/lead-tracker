/**
 * Helper: upsert de subscription. Mantém 1 row por (lead_id, gateway).
 *
 * Usado por flows.ts (webhooks) e pelos syncs (ticto/stripe/asaas) — todo
 * caminho que muda estado de assinatura precisa chamar isso pra MRR ficar
 * em sincronia com `subscriptions`.
 */
import { db } from "../../db/client.js";
import {
  subscriptions,
  type Periodicidade,
  type SubscriptionStatus,
} from "../../db/schema.js";
import { and, eq } from "drizzle-orm";

export type UpsertSubArgs = {
  leadId: number;
  gateway: string; // "ticto" | "stripe" | "asaas" | etc
  status: SubscriptionStatus;
  valor: number | null;
  planoNome: string | null;
  periodicidade: Periodicidade;
  produtoId?: number | null;
  gatewaySubscriptionId?: string | null;
  gatewayCustomerId?: string | null;
  pagouEm?: Date | null;
  proximoPagamentoEm?: Date | null;
  ultimaRenovacaoEm?: Date | null;
  canceladoEm?: Date | null;
};

export async function upsertSubscription(args: UpsertSubArgs): Promise<void> {
  // 'nenhuma' = sem assinatura — não cria/mantém row.
  if (args.status === "nenhuma") return;

  const existing = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.leadId, args.leadId),
      eq(subscriptions.gateway, args.gateway),
    ),
  });

  const now = new Date();

  if (!existing) {
    await db.insert(subscriptions).values({
      leadId: args.leadId,
      gateway: args.gateway,
      gatewaySubscriptionId: args.gatewaySubscriptionId ?? null,
      gatewayCustomerId: args.gatewayCustomerId ?? null,
      produtoId: args.produtoId ?? null,
      planoNome: args.planoNome,
      valor: args.valor,
      periodicidade: args.periodicidade,
      status: args.status,
      pagouEm: args.pagouEm ?? (args.status === "ativa" ? now : null),
      proximoPagamentoEm: args.proximoPagamentoEm ?? null,
      ultimaRenovacaoEm: args.ultimaRenovacaoEm ?? null,
      canceladoEm: args.canceladoEm ?? (args.status === "cancelada" ? now : null),
    });
    return;
  }

  const updates: Record<string, unknown> = {
    status: args.status,
    atualizadoEm: now,
  };
  if (args.valor != null) updates.valor = args.valor;
  if (args.planoNome) updates.planoNome = args.planoNome;
  if (args.periodicidade) updates.periodicidade = args.periodicidade;
  if (args.gatewaySubscriptionId) updates.gatewaySubscriptionId = args.gatewaySubscriptionId;
  if (args.gatewayCustomerId) updates.gatewayCustomerId = args.gatewayCustomerId;
  if (args.produtoId != null) updates.produtoId = args.produtoId;
  // pagouEm = data da PRIMEIRA cobrança paga (não muda em renovações).
  // Atualiza se: existing é null OU novo é mais antigo que existing
  // (corrige bug onde sync setou pagou_em = NOW() em vez da data real).
  if (
    args.pagouEm &&
    (!existing.pagouEm || args.pagouEm.getTime() < existing.pagouEm.getTime())
  ) {
    updates.pagouEm = args.pagouEm;
  }
  if (args.proximoPagamentoEm) updates.proximoPagamentoEm = args.proximoPagamentoEm;
  if (args.ultimaRenovacaoEm) updates.ultimaRenovacaoEm = args.ultimaRenovacaoEm;
  if (args.status === "cancelada" && !existing.canceladoEm) {
    updates.canceladoEm = args.canceladoEm ?? now;
  }

  await db
    .update(subscriptions)
    .set(updates)
    .where(eq(subscriptions.id, existing.id));
}
