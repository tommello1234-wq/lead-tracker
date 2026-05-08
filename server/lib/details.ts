/**
 * Detalhes drill-down dos cards do dashboard.
 * Cada `kind` retorna a lista de leads relevantes ao card clicado.
 */
import { db } from "../../db/client.js";
import { leads, subscriptions, eventos, type Lead } from "../../db/schema.js";
import { and, eq, gte, lte, isNotNull, isNull, desc, inArray, sql } from "drizzle-orm";

export type DetailsKind =
  | "ativos"
  | "novos"
  | "em_risco"
  | "pix_gerados"
  | "pix_pagos"
  | "pix_expirados"
  | "cancelados"
  | "reembolsos"
  | "compras"
  | "fila_msgs";

export type DetailLead = {
  id: number;
  subscriptionId?: number; // se row é de uma sub específica (ativos)
  eventoId?: number; // se row é de uma transação específica (compras)
  eventType?: string; // 'compra_aprovada' | 'assinatura_renovada' | 'reembolso'
  nome: string;
  contato: string | null;
  email: string | null;
  status: string;
  subscriptionStatus: string;
  planoNome: string | null;
  valorAssinatura: number | null;
  gateway: string | null;
  periodicidade: string;
  pagouEm: string | null;
  proximoPagamentoEm?: string | null;
  canceladoEm: string | null;
  criadoEm: string;
  atualizadoEm: string;
};

function toDetail(l: Lead): DetailLead {
  return {
    id: l.id,
    nome: l.nome,
    contato: l.contato,
    email: l.email,
    status: l.status,
    subscriptionStatus: l.subscriptionStatus,
    planoNome: l.planoNome,
    valorAssinatura: l.valorAssinatura,
    gateway: l.gateway,
    periodicidade: l.periodicidade,
    pagouEm: l.pagouEm?.toISOString() ?? null,
    canceladoEm: l.canceladoEm?.toISOString() ?? null,
    criadoEm: l.criadoEm.toISOString(),
    atualizadoEm: l.atualizadoEm.toISOString(),
  };
}

export async function getDetails(
  kind: DetailsKind,
  produtoId: number | null,
  since: Date | null,
  until: Date | null,
): Promise<DetailLead[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (produtoId != null) conds.push(eq(leads.produtoId, produtoId));

  switch (kind) {
    case "ativos": {
      // 1 row por subscription ativa (não por lead).
      // Lead com 2 subs ativas vira 2 rows, cada uma com gateway/plano/valor da sub.
      const subConds = [eq(subscriptions.status, "ativa")];
      if (produtoId != null) subConds.push(eq(subscriptions.produtoId, produtoId));
      const rows = await db
        .select({
          subId: subscriptions.id,
          subGateway: subscriptions.gateway,
          subPlano: subscriptions.planoNome,
          subValor: subscriptions.valor,
          subPeriod: subscriptions.periodicidade,
          subPagouEm: subscriptions.pagouEm,
          subProxPag: subscriptions.proximoPagamentoEm,
          subStatus: subscriptions.status,
          lead: leads,
        })
        .from(subscriptions)
        .innerJoin(leads, eq(leads.id, subscriptions.leadId))
        .where(and(...subConds))
        .orderBy(desc(subscriptions.valor), desc(subscriptions.pagouEm))
        .limit(1000);
      return rows.map((r) => ({
        ...toDetail(r.lead),
        subscriptionId: r.subId,
        gateway: r.subGateway,
        planoNome: r.subPlano,
        valorAssinatura: r.subValor,
        periodicidade: r.subPeriod,
        pagouEm: r.subPagouEm?.toISOString() ?? null,
        proximoPagamentoEm: r.subProxPag?.toISOString() ?? null,
        subscriptionStatus: r.subStatus,
      }));
    }

    case "novos": {
      if (since) conds.push(gte(leads.criadoEm, since));
      if (until) conds.push(lte(leads.criadoEm, until));
      return (
        await db
          .select()
          .from(leads)
          .where(and(...conds))
          .orderBy(desc(leads.criadoEm))
          .limit(500)
      ).map(toDetail);
    }

    case "em_risco":
      conds.push(eq(leads.status, "cliente_em_risco"));
      // Em risco não tem data canônica clara, usa atualizadoEm (último
      // movimento que provocou o estado).
      if (since) conds.push(gte(leads.atualizadoEm, since));
      if (until) conds.push(lte(leads.atualizadoEm, until));
      return (
        await db
          .select()
          .from(leads)
          .where(and(...conds))
          .orderBy(desc(leads.atualizadoEm))
          .limit(500)
      ).map(toDetail);

    case "pix_gerados": {
      conds.push(isNotNull(leads.pixGeradoEm));
      if (since) conds.push(gte(leads.pixGeradoEm, since));
      if (until) conds.push(lte(leads.pixGeradoEm, until));
      return (
        await db
          .select()
          .from(leads)
          .where(and(...conds))
          .orderBy(desc(leads.pixGeradoEm))
          .limit(500)
      ).map(toDetail);
    }

    case "pix_pagos": {
      conds.push(isNotNull(leads.pixGeradoEm));
      conds.push(isNotNull(leads.pagouEm));
      if (since) conds.push(gte(leads.pixGeradoEm, since));
      if (until) conds.push(lte(leads.pixGeradoEm, until));
      return (
        await db
          .select()
          .from(leads)
          .where(and(...conds))
          .orderBy(desc(leads.pagouEm))
          .limit(500)
      ).map(toDetail);
    }

    case "pix_expirados": {
      conds.push(isNotNull(leads.pixGeradoEm));
      conds.push(eq(leads.status, "pix_expirado"));
      if (since) conds.push(gte(leads.pixGeradoEm, since));
      if (until) conds.push(lte(leads.pixGeradoEm, until));
      return (
        await db
          .select()
          .from(leads)
          .where(and(...conds))
          .orderBy(desc(leads.pixGeradoEm))
          .limit(500)
      ).map(toDetail);
    }

    case "cancelados":
      conds.push(eq(leads.subscriptionStatus, "cancelada"));
      // Filtro de período usa canceladoEm (data canônica da transição).
      if (since) conds.push(gte(leads.canceladoEm, since));
      if (until) conds.push(lte(leads.canceladoEm, until));
      return (
        await db
          .select()
          .from(leads)
          .where(and(...conds))
          .orderBy(desc(leads.canceladoEm))
          .limit(500)
      ).map(toDetail);

    case "reembolsos":
      conds.push(eq(leads.subscriptionStatus, "reembolsada"));
      // Filtro de período usa reembolsadoEm (data canônica). Sem isso, o
      // modal mostrava reembolsos lifetime mesmo com filtro "hoje" ativo.
      if (since) conds.push(gte(leads.reembolsadoEm, since));
      if (until) conds.push(lte(leads.reembolsadoEm, until));
      return (
        await db
          .select()
          .from(leads)
          .where(and(...conds))
          .orderBy(desc(leads.reembolsadoEm))
          .limit(500)
      ).map(toDetail);

    case "compras": {
      // 1 row por TRANSAÇÃO (evento compra_aprovada/renovada/reembolso),
      // não 1 row por lead. Bate exatamente com o card "Faturamento" do
      // dashboard. Valor extraído do payload do evento (cobrança real,
      // não lead.valorAssinatura que pode ter sido atualizado).
      const evConds = [
        eq(eventos.processedOk, true),
        // Exclui duplicatas / ignorados (têm erro preenchido mesmo com OK=true)
        isNull(eventos.erro),
        inArray(eventos.eventType, ["compra_aprovada", "assinatura_renovada", "reembolso"]),
      ];
      if (produtoId != null) evConds.push(eq(eventos.produtoId, produtoId));
      if (since) evConds.push(gte(eventos.receivedAt, since));
      if (until) evConds.push(lte(eventos.receivedAt, until));

      const valorExpr = sql<number>`coalesce(
        ((${eventos.payload}->'item'->>'amount')::numeric / 100),
        ((${eventos.payload}->'transaction'->>'paid_amount')::numeric / 100),
        ((${eventos.payload}->'offer'->>'price')::numeric / 100),
        ((${eventos.payload}->'data'->'object'->>'amount_total')::numeric / 100),
        ((${eventos.payload}->'payment'->>'value')::numeric),
        0
      )::numeric(10,2)`;

      const rows = await db
        .select({
          eventoId: eventos.id,
          eventType: eventos.eventType,
          source: eventos.source,
          receivedAt: eventos.receivedAt,
          valor: valorExpr,
          lead: leads,
        })
        .from(eventos)
        .innerJoin(leads, eq(leads.id, eventos.leadId))
        .where(and(...evConds))
        .orderBy(desc(eventos.receivedAt))
        .limit(1000);

      // Deriva gateway a partir do source do evento, não do lead.gateway
      // (lead pode ter sido tocado por múltiplos gateways ao longo do tempo,
      // o gateway atual não reflete de onde cada transação veio).
      function gatewayFromSource(src: string): string {
        if (src.startsWith("ticto")) return "ticto";
        if (src.startsWith("asaas")) return "asaas";
        if (src.startsWith("stripe")) return "stripe";
        return src;
      }

      return rows.map((r) => ({
        ...toDetail(r.lead),
        eventoId: r.eventoId,
        eventType: r.eventType,
        gateway: gatewayFromSource(r.source),
        valorAssinatura:
          r.eventType === "reembolso" ? -Number(r.valor) : Number(r.valor),
        pagouEm: r.receivedAt.toISOString(),
      }));
    }

    case "fila_msgs":
      // Pra fila de mensagens não retornamos leads — frontend pode usar /automacoes
      return [];

    default:
      return [];
  }
}
