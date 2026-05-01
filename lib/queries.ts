import { db } from "@/db/client";
import { leads, mensagensAgendadas, type Lead } from "@/db/schema";
import { desc, eq, and, gte } from "drizzle-orm";

export async function getAllLeads(): Promise<Lead[]> {
  return db.select().from(leads).orderBy(desc(leads.criadoEm));
}

export type DashboardMetrics = {
  // Volumes
  totalLeads: number;
  vendasHoje: number;
  vendasMes: number;

  // MRR (Monthly Recurring Revenue)
  mrr: number;
  mrrPotencial: number; // se 100% dos PIX gerados convertessem
  clientesAtivos: number;

  // Funil
  pixGerados: number;
  pixPagos: number;
  pixExpirados: number;
  taxaConversaoPix: number; // pagos / gerados
  receitaPerdidaPix: number; // valor dos PIX que expiraram

  // Engajamento
  filaSuporte: number; // mensagens pending nao enviadas
  mensagensEnviadasHoje: number;

  // Saude
  emRisco: number;
  cancelados: number;
  reembolsos: number;
};

function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d: Date) {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export async function getDashboardMetrics(): Promise<DashboardMetrics> {
  const all = await db.select().from(leads);
  const today = startOfDay(new Date());
  const monthStart = startOfMonth(new Date());

  const clientesAtivos = all.filter((l) => l.subscriptionStatus === "ativa");
  const mrr = clientesAtivos.reduce((acc, l) => acc + (l.valorAssinatura ?? 0), 0);

  const pixGerados = all.filter((l) => l.pixGeradoEm != null);
  const pixPagos = all.filter((l) => l.pagouEm != null);
  const pixExpirados = all.filter((l) => l.status === "pix_expirado");

  const vendasHoje = all.filter((l) => l.pagouEm && l.pagouEm >= today);
  const vendasMes = all.filter((l) => l.pagouEm && l.pagouEm >= monthStart);

  const mrrPotencial =
    mrr +
    all
      .filter((l) => l.subscriptionStatus === "aguardando_pagamento")
      .reduce((acc, l) => acc + (l.valorAssinatura ?? 0), 0);

  const receitaPerdidaPix = pixExpirados.reduce(
    (acc, l) => acc + (l.valorAssinatura ?? l.valorEstimado ?? 0),
    0,
  );

  // Fila de suporte = mensagens pending criadas via interacao manual ou
  // mensagens nao processadas. Aqui usamos pending como proxy.
  const pendingMsgs = await db
    .select()
    .from(mensagensAgendadas)
    .where(eq(mensagensAgendadas.status, "pending"));

  const sentToday = await db
    .select()
    .from(mensagensAgendadas)
    .where(
      and(
        eq(mensagensAgendadas.status, "sent"),
        gte(mensagensAgendadas.enviadoEm, today),
      ),
    );

  return {
    totalLeads: all.length,
    vendasHoje: vendasHoje.length,
    vendasMes: vendasMes.length,
    mrr,
    mrrPotencial,
    clientesAtivos: clientesAtivos.length,
    pixGerados: pixGerados.length,
    pixPagos: pixPagos.length,
    pixExpirados: pixExpirados.length,
    taxaConversaoPix: pixGerados.length > 0 ? pixPagos.length / pixGerados.length : 0,
    receitaPerdidaPix,
    filaSuporte: pendingMsgs.length,
    mensagensEnviadasHoje: sentToday.length,
    emRisco: all.filter((l) => l.status === "cliente_em_risco").length,
    cancelados: all.filter((l) => l.status === "cliente_cancelado").length,
    reembolsos: all.filter((l) => l.subscriptionStatus === "reembolsada").length,
  };
}

export type DailyMetric = {
  date: string;
  entradas: number;
  convertidos: number;
  taxaConversao: number;
};

export async function getDailySeries(days = 30): Promise<DailyMetric[]> {
  const all = await db.select().from(leads);
  const today = startOfDay(new Date());

  const series: DailyMetric[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const next = new Date(day);
    next.setDate(day.getDate() + 1);

    const entradas = all.filter(
      (l) => l.criadoEm >= day && l.criadoEm < next,
    ).length;
    const convertidos = all.filter(
      (l) => l.pagouEm && l.pagouEm >= day && l.pagouEm < next,
    ).length;

    series.push({
      date: day.toISOString().slice(0, 10),
      entradas,
      convertidos,
      taxaConversao: entradas > 0 ? convertidos / entradas : 0,
    });
  }
  return series;
}

export type TipoBreakdown = { tipo: string; total: number };

export async function getTipoBreakdown(): Promise<TipoBreakdown[]> {
  const all = await db.select().from(leads);
  const counts = new Map<string, number>();
  for (const l of all) {
    counts.set(l.tipo, (counts.get(l.tipo) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([tipo, total]) => ({ tipo, total }));
}
