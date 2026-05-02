/**
 * Feed de atividade em tempo real + snapshot do funil.
 * Alimenta os componentes "ecossistema vivo" do dashboard.
 */
import { db } from "../../db/client.js";
import { leads, type LeadStatus } from "../../db/schema.js";
import { desc, eq, and, sql, inArray } from "drizzle-orm";

export type ActivityItem = {
  id: number;
  tipo: "evento" | "mensagem_enviada" | "mensagem_cancelada";
  eventType: string; // "compra_aprovada" | "pix_gerado" | etc OU "msg_sent" | "msg_skipped"
  leadId: number | null;
  leadNome: string | null;
  leadContato: string | null;
  produtoId: number | null;
  produtoNome: string | null;
  receivedAt: string; // ISO
  /** Detalhes específicos do tipo. */
  meta?: {
    valor?: number | null;
    template?: string | null;
    erro?: string | null;
  };
};

export type FunilSnapshot = {
  status: string;
  count: number;
  leads: Array<{
    id: number;
    nome: string;
    contato: string | null;
    valorAssinatura: number | null;
    atualizadoEm: string;
    horasNoEstagio: number;
    mensagensEnviadas: number;
  }>;
};

/* ============================================================
 * Feed: combina eventos do gateway + mensagens enviadas/canceladas
 * Limita a últimas N entradas, ordenado por timestamp desc.
 * ============================================================ */
export async function getRecentActivity(
  produtoId: number | null = null,
  limit = 30,
): Promise<ActivityItem[]> {
  // 1. Eventos do gateway (com lead joined)
  const eventosResult = await db.execute<{
    id: number;
    event_type: string;
    received_at: Date;
    lead_id: number | null;
    lead_nome: string | null;
    lead_contato: string | null;
    produto_id: number | null;
    produto_nome: string | null;
    valor: number | null;
  }>(sql`
    select
      e.id,
      e.event_type,
      e.received_at,
      l.id as lead_id,
      l.nome as lead_nome,
      l.contato as lead_contato,
      p.id as produto_id,
      p.nome as produto_nome,
      coalesce(
        (e.payload->>'valor')::numeric,
        ((e.payload->'item'->>'amount')::numeric / 100),
        l.valor_assinatura
      ) as valor
    from eventos e
    left join leads l on l.id = e.lead_id
    left join produtos p on p.id = coalesce(e.produto_id, l.produto_id)
    where e.processed_ok = true
      ${produtoId != null ? sql`and (e.produto_id = ${produtoId} or l.produto_id = ${produtoId})` : sql``}
    order by e.received_at desc
    limit ${limit}
  `);

  // 2. Mensagens enviadas/canceladas recentes
  const msgsResult = await db.execute<{
    id: number;
    status: string;
    sent_at: Date | null;
    template: string;
    erro: string | null;
    lead_id: number;
    lead_nome: string;
    lead_contato: string | null;
    produto_id: number | null;
    produto_nome: string | null;
  }>(sql`
    select
      m.id,
      m.status,
      coalesce(m.enviado_em, m.criado_em) as sent_at,
      m.template,
      m.erro,
      l.id as lead_id,
      l.nome as lead_nome,
      l.contato as lead_contato,
      p.id as produto_id,
      p.nome as produto_nome
    from mensagens_agendadas m
    join leads l on l.id = m.lead_id
    left join produtos p on p.id = l.produto_id
    where m.status in ('sent', 'skipped', 'failed')
      ${produtoId != null ? sql`and l.produto_id = ${produtoId}` : sql``}
    order by sent_at desc
    limit ${limit}
  `);

  // Merge + sort por timestamp desc
  const items: ActivityItem[] = [
    ...(eventosResult as unknown as Array<{
      id: number;
      event_type: string;
      received_at: Date;
      lead_id: number | null;
      lead_nome: string | null;
      lead_contato: string | null;
      produto_id: number | null;
      produto_nome: string | null;
      valor: number | null;
    }>).map((e) => ({
      id: e.id,
      tipo: "evento" as const,
      eventType: e.event_type,
      leadId: e.lead_id,
      leadNome: e.lead_nome,
      leadContato: e.lead_contato,
      produtoId: e.produto_id,
      produtoNome: e.produto_nome,
      receivedAt: new Date(e.received_at).toISOString(),
      meta: { valor: e.valor != null ? Number(e.valor) : null },
    })),
    ...(msgsResult as unknown as Array<{
      id: number;
      status: string;
      sent_at: Date;
      template: string;
      erro: string | null;
      lead_id: number;
      lead_nome: string;
      lead_contato: string | null;
      produto_id: number | null;
      produto_nome: string | null;
    }>).map((m) => ({
      id: m.id + 1_000_000_000, // namespace pra não colidir com IDs de eventos
      tipo:
        m.status === "sent"
          ? ("mensagem_enviada" as const)
          : ("mensagem_cancelada" as const),
      eventType: m.status === "sent" ? "msg_sent" : `msg_${m.status}`,
      leadId: m.lead_id,
      leadNome: m.lead_nome,
      leadContato: m.lead_contato,
      produtoId: m.produto_id,
      produtoNome: m.produto_nome,
      receivedAt: new Date(m.sent_at).toISOString(),
      meta: { template: m.template, erro: m.erro },
    })),
  ];

  return items
    .sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    )
    .slice(0, limit);
}

/* ============================================================
 * Funil snapshot: leads agrupados por status atual
 * com tempo no estágio e principais infos.
 * ============================================================ */
export async function getFunilSnapshot(
  produtoId: number | null = null,
): Promise<FunilSnapshot[]> {
  // Apenas status "ativos" (não inclui legados como "novo", "respondeu")
  const ACTIVE_STATUSES: LeadStatus[] = [
    "lead_novo",
    "carrinho_abandonado",
    "pix_gerado",
    "pix_expirado",
    "cliente_ativo",
    "cliente_em_risco",
    "cliente_cancelado",
  ];

  // SQL com sub-SELECT pra contar mensagens enviadas (status='sent') por lead
  // E também pega o último received_at de evento real pra calcular tempo no estágio.
  // Se não houver evento, fallback pra atualizado_em.
  const all = await db.execute<{
    id: number;
    nome: string;
    contato: string | null;
    status: string;
    valor_assinatura: number | null;
    atualizado_em: Date;
    msgs_enviadas: number;
  }>(sql`
    select
      l.id,
      l.nome,
      l.contato,
      l.status,
      l.valor_assinatura,
      coalesce(
        (select max(received_at) from eventos
         where lead_id = l.id and processed_ok = true),
        l.atualizado_em
      ) as atualizado_em,
      coalesce(
        (select count(*)::int from mensagens_agendadas
         where lead_id = l.id and status = 'sent'),
        0
      ) as msgs_enviadas
    from leads l
    where l.status in ${sql.raw(`(${ACTIVE_STATUSES.map((s) => `'${s}'`).join(",")})`)}
      ${produtoId != null ? sql`and l.produto_id = ${produtoId}` : sql``}
    order by l.atualizado_em desc
    limit 500
  `);

  const allRows = all as unknown as Array<{
    id: number;
    nome: string;
    contato: string | null;
    status: string;
    valor_assinatura: number | null;
    atualizado_em: Date;
    msgs_enviadas: number;
  }>;

  const now = Date.now();
  const grouped = new Map<string, FunilSnapshot["leads"]>();

  for (const l of allRows) {
    const horas =
      l.atualizado_em != null
        ? Math.floor((now - new Date(l.atualizado_em).getTime()) / (60 * 60 * 1000))
        : 0;
    const arr = grouped.get(l.status) ?? [];
    if (arr.length < 8) {
      arr.push({
        id: l.id,
        nome: l.nome,
        contato: l.contato,
        valorAssinatura: l.valor_assinatura != null ? Number(l.valor_assinatura) : null,
        atualizadoEm: new Date(l.atualizado_em).toISOString(),
        horasNoEstagio: horas,
        mensagensEnviadas: Number(l.msgs_enviadas),
      });
    }
    grouped.set(l.status, arr);
  }

  // Ordem fixa das colunas (funil)
  return ACTIVE_STATUSES.map((status) => ({
    status,
    count: allRows.filter((l) => l.status === status).length,
    leads: grouped.get(status) ?? [],
  }));
}
