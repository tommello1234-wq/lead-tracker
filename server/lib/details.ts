/**
 * Detalhes drill-down dos cards do dashboard.
 * Cada `kind` retorna a lista de leads relevantes ao card clicado.
 */
import { db } from "../../db/client.js";
import { leads, subscriptions, type Lead } from "../../db/schema.js";
import { and, eq, gte, lte, isNotNull, desc } from "drizzle-orm";

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
      return (
        await db
          .select()
          .from(leads)
          .where(and(...conds))
          .orderBy(desc(leads.atualizadoEm))
          .limit(500)
      ).map(toDetail);

    case "compras": {
      conds.push(isNotNull(leads.pagouEm));
      if (since) conds.push(gte(leads.pagouEm, since));
      if (until) conds.push(lte(leads.pagouEm, until));
      return (
        await db
          .select()
          .from(leads)
          .where(and(...conds))
          .orderBy(desc(leads.pagouEm))
          .limit(500)
      ).map(toDetail);
    }

    case "fila_msgs":
      // Pra fila de mensagens não retornamos leads — frontend pode usar /automacoes
      return [];

    default:
      return [];
  }
}
