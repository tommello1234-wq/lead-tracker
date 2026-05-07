/**
 * REGRAS DE STATUS — fonte canônica de como cada estado é determinado.
 *
 * Antes deste arquivo existir, status estavam espalhados em:
 *  - leads.subscriptionStatus  (snapshot)
 *  - subscriptions.status       (snapshot por gateway)
 *  - eventos.event_type         (histórico)
 *  - mrr_movements.type         (derivado)
 *
 * Quando essas 4 fontes divergiam, cada query escolhia uma e o número
 * dava errado em algum lugar (Daniel ativo + Ticto reembolsou, MRR contava
 * ele; Reembolsos no período inflado por sync de preço, etc).
 *
 * INVARIANTES (cada uma testada por /api/audit/consistency):
 *
 *  I1. lead.subscriptionStatus === 'ativa'  ⇒  ∃ sub ativa pra esse lead
 *  I2. ∃ sub ativa pra lead                 ⇒  lead.subscriptionStatus === 'ativa'
 *  I3. lead.subscriptionStatus === 'reembolsada'  ⇒  lead.reembolsadoEm IS NOT NULL
 *  I4. lead.subscriptionStatus === 'cancelada'    ⇒  lead.canceladoEm IS NOT NULL
 *  I5. ∃ evento 'reembolso' processado_ok ⇒ ∃ mrr_movement type=refund linkado
 *  I6. ∃ evento 'assinatura_cancelada' processado_ok ⇒ ∃ mrr_movement type=churn
 *  I7. sub.status === 'ativa' ⇒ sub.valor > 0
 *  I8. lead.subscriptionStatus === 'ativa' ⇒ lead.pagouEm IS NOT NULL
 *  I9. eventos com mesmo (lead_id, event_type, order_hash) processado_ok=true
 *      e erro IS NULL devem ser únicos (zero duplicatas)
 *
 * REGRAS DE TRANSIÇÃO (aplicadas em flows.ts):
 *
 *  R1. Status real do gateway vem da ÚLTIMA TRANSAÇÃO, não do campo
 *      "situation". Ticto não atualiza situation após refund de cobrança.
 *      → ticto-sync.realSubStatus / audit.realStatus aplicam essa regra.
 *
 *  R2. Cancelamento de gateway DIFERENTE do gateway atual NÃO sobrescreve
 *      lead ativo em outro gateway. Cliente migrou Ticto→Stripe, cancela
 *      Ticto antigo: ignorar.
 *      → flows.ts handleGatewayEvent (guard "lateral cancel")
 *
 *  R3. Webhooks duplicados (mesmo order_hash/tx_hash em 24h) são ignorados.
 *      Ticto manda às vezes 2x em 48ms.
 *      → flows.ts isDuplicateByHash
 *
 *  R4. Cada lead pode ter MÚLTIPLAS subs (1 por gateway). MRR vem da soma
 *      de subs ativas, não de leads.valorAssinatura.
 *      → queries.ts getDashboardMetrics
 *
 *  R5. Datas históricas usam campos canônicos de transição:
 *       - pagouEm: data 1ª compra (estável)
 *       - canceladoEm: setado só na transição → cancelada
 *       - reembolsadoEm: setado só na transição → reembolsada (NOVO)
 *       - pixGeradoEm: data do PIX
 *      Nunca usar atualizadoEm (muda em qualquer UPDATE).
 *
 *  R6. Métricas históricas em janela ("X no período") devem usar:
 *       - Eventos (eventos.received_at + event_type) para máxima precisão
 *       - OU campo canônico de transição quando esse for setado só
 *         exatamente naquele momento (canceladoEm, reembolsadoEm)
 *      Snapshot fields (lead.status, lead.subscriptionStatus) só pra
 *      "estado atual", nunca pra histórico.
 *
 *  R7. Valores monetários históricos vêm do PAYLOAD do evento (já tem o
 *      valor que foi cobrado naquele momento), não de leads.valorAssinatura
 *      (que pode ser atualizado pra refletir cobrança recorrente atual).
 *      → queries.ts getFaturamento.valorExpr
 */

import type { Lead, SubscriptionStatus } from "../../db/schema.js";

/**
 * Determina o subscription_status canônico do lead a partir das suas subs.
 * Lead com 1+ subs ativas = 'ativa'. Sem ativa, mas com sub atrasada = 'atrasada'.
 * Sem ativa nem atrasada, mas com cancelada = 'cancelada'. Etc.
 *
 * Hierarquia: ativa > atrasada > aguardando > reembolsada > cancelada > nenhuma.
 */
export function deriveLeadStatusFromSubs(
  subs: Array<{ status: SubscriptionStatus }>,
): SubscriptionStatus {
  if (subs.length === 0) return "nenhuma";
  const order: SubscriptionStatus[] = [
    "ativa",
    "atrasada",
    "aguardando_pagamento",
    "reembolsada",
    "cancelada",
    "nenhuma",
  ];
  for (const candidate of order) {
    if (subs.some((s) => s.status === candidate)) return candidate;
  }
  return "nenhuma";
}

/**
 * Determina o status real de uma sub Ticto. Ticto.situation pode ficar stale
 * (ex: refunded transaction não atualiza situation pra 'Reembolsada').
 * Confia na última transaction. Aplicar mesmo padrão pra Stripe (latest_invoice)
 * e Asaas (último payment).
 */
export function realTictoSubStatus(sub: {
  situation?: string | null;
  status?: string | null;
  transactions?: Array<{ status?: string; is_latest_transaction?: boolean }>;
}): string {
  const txs = sub.transactions ?? [];
  const latest = txs.find((t) => t.is_latest_transaction) ?? txs[0];
  if (latest?.status) {
    const s = String(latest.status).toLowerCase();
    if (s === "refunded" || s === "chargeback") return "reembolsada";
    if (s === "delayed") return "atrasada";
    if (s === "refused") return "atrasada";
  }
  return String(sub.situation ?? sub.status ?? "");
}

/**
 * Lead "saudável" = ativo com pagouEm + sub ativa com valor > 0.
 * Lead inválido = quebra alguma invariante.
 */
export function isHealthyActiveLead(
  lead: Pick<Lead, "subscriptionStatus" | "pagouEm">,
  subs: Array<{ status: SubscriptionStatus; valor: number | null }>,
): boolean {
  if (lead.subscriptionStatus !== "ativa") return false;
  if (!lead.pagouEm) return false;
  const activeSubs = subs.filter((s) => s.status === "ativa");
  if (activeSubs.length === 0) return false;
  if (activeSubs.some((s) => !s.valor || s.valor <= 0)) return false;
  return true;
}
