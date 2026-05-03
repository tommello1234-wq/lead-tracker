/**
 * Métricas SaaS profundas — extraídas via SQL JSON da tabela `eventos`.
 *
 * Estratégia: a coluna `payload` (jsonb) já guarda o webhook bruto de cada
 * gateway. Em vez de migrar schema (adicionar `metodo_pagamento` etc no
 * lead), derivamos via JSON query. Funciona pra histórico todo, sem risco.
 *
 * Convenções de payload por gateway:
 *   - Ticto:  payload->>'payment_method' = "credit_card" | "pix" | "boleto"
 *   - Stripe: payload->'data'->'object'->'payment_method_types'->>0
 *   - Brevex: TBD (parser stub até o user mandar exemplo)
 */
import { db } from "../../db/client.js";
import { eventos, leads } from "../../db/schema.js";
import { sql, eq, and, inArray, gte, lte } from "drizzle-orm";

export type PaymentMethod = "cartao" | "pix" | "boleto" | "indefinido";

export type MetodoBreakdown = {
  metodo: PaymentMethod;
  totalCompras: number; // qtd transações
  ativos: number; // assinantes ativos hoje (subscription_status='ativa')
  receitaTotal: number; // soma de tudo que entrou via esse método
  mrr: number; // MRR atual (apenas ativos)
  arpu: number; // receita média por usuário
};

export type FunilPix = {
  gerados: number;
  pagos: number;
  expirados: number;
  recovered: number; // PIX que expirou e depois pagou
  taxaConversao: number; // pagos / gerados
};

export type RetencaoPorMetodo = {
  metodo: PaymentMethod;
  clientesUnicos: number;
  diasMediosAtivo: number;
  taxaRetencao30d: number; // % que ainda tá ativo após 30 dias
  taxaRetencao90d: number;
};

/**
 * Helper: extrai payment_method normalizado (cartao/pix/boleto/indefinido)
 * de qualquer payload. Usado dentro de queries SQL.
 *
 * Mapeamento:
 *   - "credit_card", "card", "cartao" → "cartao"
 *   - "pix" → "pix"
 *   - "boleto", "bank_slip" → "boleto"
 *   - resto → "indefinido"
 */
const metodoExpr = sql<string>`
  case
    when lower(coalesce(
      ${eventos.payload}->>'payment_method',
      ${eventos.payload}->'transaction'->>'payment_method',
      ${eventos.payload}->'data'->'object'->'payment_method_types'->>0,
      ${eventos.payload}->>'method'
    )) in ('credit_card', 'card', 'cartao', 'cartão_credito') then 'cartao'
    when lower(coalesce(
      ${eventos.payload}->>'payment_method',
      ${eventos.payload}->'transaction'->>'payment_method',
      ${eventos.payload}->'data'->'object'->'payment_method_types'->>0,
      ${eventos.payload}->>'method'
    )) = 'pix' then 'pix'
    when lower(coalesce(
      ${eventos.payload}->>'payment_method',
      ${eventos.payload}->'transaction'->>'payment_method',
      ${eventos.payload}->'data'->'object'->'payment_method_types'->>0,
      ${eventos.payload}->>'method'
    )) in ('boleto', 'bank_slip') then 'boleto'
    else 'indefinido'
  end
`;

/**
 * Mesma extração de valor (em reais) que getFaturamento usa.
 */
const valorExpr = sql<number>`coalesce(
  (${eventos.payload}->>'valor')::numeric,
  ((${eventos.payload}->'item'->>'amount')::numeric / 100),
  ((${eventos.payload}->'data'->'object'->>'amount_total')::numeric / 100),
  (select valor_assinatura from leads where id = ${eventos.leadId}),
  0
)::numeric(10,2)`;

/* ============================================================
 * 1. Breakdown por método de pagamento
 * Junta: total de transações + receita + ativos atuais (via lead)
 * ============================================================ */
export async function getMetodoBreakdown(
  produtoId: number | null = null,
  since: Date | null = null,
  until: Date | null = null,
): Promise<MetodoBreakdown[]> {
  const conditions = [
    inArray(eventos.eventType, ["compra_aprovada", "assinatura_renovada"]),
    eq(eventos.processedOk, true),
  ];
  if (produtoId != null) conditions.push(eq(eventos.produtoId, produtoId));
  if (since != null) conditions.push(gte(eventos.receivedAt, since));
  if (until != null) conditions.push(lte(eventos.receivedAt, until));

  // Total transações + receita por método
  const transacoes = await db
    .select({
      metodo: metodoExpr,
      total: sql<number>`count(*)::int`,
      receita: sql<number>`coalesce(sum(${valorExpr}), 0)::numeric(10,2)`,
    })
    .from(eventos)
    .where(and(...conditions))
    .groupBy(metodoExpr);

  // Pra cada método, contar ativos hoje (snapshot)
  // Como o lead não tem método persistido, derivamos do ÚLTIMO evento de
  // compra/renovação dele.
  const leadsPorMetodo = await db.execute<{
    metodo: string;
    ativos: number;
    mrr: number;
  }>(sql`
    with ultimo_evento as (
      select distinct on (e.lead_id)
        e.lead_id,
        case
          when lower(coalesce(
            e.payload->>'payment_method',
            e.payload->'transaction'->>'payment_method',
            e.payload->'data'->'object'->'payment_method_types'->>0,
            e.payload->>'method'
          )) in ('credit_card', 'card', 'cartao') then 'cartao'
          when lower(coalesce(
            e.payload->>'payment_method',
            e.payload->'transaction'->>'payment_method',
            e.payload->'data'->'object'->'payment_method_types'->>0,
            e.payload->>'method'
          )) = 'pix' then 'pix'
          when lower(coalesce(
            e.payload->>'payment_method',
            e.payload->'transaction'->>'payment_method',
            e.payload->'data'->'object'->'payment_method_types'->>0,
            e.payload->>'method'
          )) in ('boleto', 'bank_slip') then 'boleto'
          else 'indefinido'
        end as metodo
      from eventos e
      where e.event_type in ('compra_aprovada', 'assinatura_renovada')
        and e.processed_ok = true
        and e.lead_id is not null
        ${produtoId != null ? sql`and e.produto_id = ${produtoId}` : sql``}
      order by e.lead_id, e.received_at desc
    )
    select
      ue.metodo,
      count(*)::int as ativos,
      coalesce(sum(l.valor_assinatura), 0)::numeric(10,2) as mrr
    from ultimo_evento ue
    join leads l on l.id = ue.lead_id
    where l.subscription_status = 'ativa'
    group by ue.metodo
  `);

  const ativosMap = new Map<string, { ativos: number; mrr: number }>();
  for (const row of leadsPorMetodo as unknown as Array<{
    metodo: string;
    ativos: number;
    mrr: number;
  }>) {
    ativosMap.set(row.metodo, {
      ativos: Number(row.ativos),
      mrr: Number(row.mrr),
    });
  }

  return transacoes.map((t) => {
    const a = ativosMap.get(String(t.metodo)) ?? { ativos: 0, mrr: 0 };
    const totalCompras = Number(t.total);
    const receitaTotal = Number(t.receita);
    return {
      metodo: t.metodo as PaymentMethod,
      totalCompras,
      ativos: a.ativos,
      receitaTotal,
      mrr: a.mrr,
      arpu: a.ativos > 0 ? a.mrr / a.ativos : 0,
    };
  });
}

/* ============================================================
 * 2. Funil PIX
 * gerados → pagos vs expirados → recovered (expirou e depois pagou)
 * ============================================================ */
export async function getFunilPix(
  produtoId: number | null = null,
  since: Date | null = null,
  until: Date | null = null,
): Promise<FunilPix> {
  const cond = [eq(eventos.processedOk, true)];
  if (produtoId != null) cond.push(eq(eventos.produtoId, produtoId));
  if (since != null) cond.push(gte(eventos.receivedAt, since));
  if (until != null) cond.push(lte(eventos.receivedAt, until));

  const counts = await db
    .select({
      eventType: eventos.eventType,
      total: sql<number>`count(*)::int`,
    })
    .from(eventos)
    .where(and(...cond))
    .groupBy(eventos.eventType);

  const map = new Map<string, number>();
  for (const r of counts) map.set(r.eventType, Number(r.total));

  const gerados = map.get("pix_gerado") ?? 0;
  const expirados = map.get("pix_expirado") ?? 0;
  const pagos = map.get("compra_aprovada") ?? 0;

  // Recovered: leads que TIVERAM um pix_expirado E DEPOIS um compra_aprovada
  const recovered = await db.execute<{ count: number }>(sql`
    select count(distinct l.id)::int as count
    from leads l
    where exists (
      select 1 from eventos e1
      where e1.lead_id = l.id
        and e1.event_type = 'pix_expirado'
        ${produtoId != null ? sql`and e1.produto_id = ${produtoId}` : sql``}
    )
    and exists (
      select 1 from eventos e2
      where e2.lead_id = l.id
        and e2.event_type = 'compra_aprovada'
        and e2.received_at > (
          select max(e3.received_at) from eventos e3
          where e3.lead_id = l.id and e3.event_type = 'pix_expirado'
        )
        ${produtoId != null ? sql`and e2.produto_id = ${produtoId}` : sql``}
    )
  `);

  const recoveredCount = Number(
    (recovered as unknown as Array<{ count: number }>)[0]?.count ?? 0,
  );

  return {
    gerados,
    pagos,
    expirados,
    recovered: recoveredCount,
    taxaConversao: gerados > 0 ? pagos / gerados : 0,
  };
}

/* ============================================================
 * 3. Retenção por método de pagamento
 * Pra cada método: quantos clientes únicos compraram, qtos
 * dias em média ficam ativos, retenção 30d e 90d.
 * ============================================================ */
export async function getRetencaoPorMetodo(
  produtoId: number | null = null,
): Promise<RetencaoPorMetodo[]> {
  const result = await db.execute<{
    metodo: string;
    clientes: number;
    dias_ativo: number;
    ativo_30d: number;
    ativo_90d: number;
  }>(sql`
    with primeiro_pagamento as (
      select distinct on (e.lead_id)
        e.lead_id,
        e.received_at as primeira_compra,
        case
          when lower(coalesce(
            e.payload->>'payment_method',
            e.payload->'transaction'->>'payment_method',
            e.payload->'data'->'object'->'payment_method_types'->>0,
            e.payload->>'method'
          )) in ('credit_card', 'card', 'cartao') then 'cartao'
          when lower(coalesce(
            e.payload->>'payment_method',
            e.payload->'transaction'->>'payment_method',
            e.payload->'data'->'object'->'payment_method_types'->>0,
            e.payload->>'method'
          )) = 'pix' then 'pix'
          when lower(coalesce(
            e.payload->>'payment_method',
            e.payload->'transaction'->>'payment_method',
            e.payload->'data'->'object'->'payment_method_types'->>0,
            e.payload->>'method'
          )) in ('boleto', 'bank_slip') then 'boleto'
          else 'indefinido'
        end as metodo
      from eventos e
      where e.event_type = 'compra_aprovada'
        and e.processed_ok = true
        and e.lead_id is not null
        ${produtoId != null ? sql`and e.produto_id = ${produtoId}` : sql``}
      order by e.lead_id, e.received_at asc
    )
    select
      pp.metodo,
      count(*)::int as clientes,
      round(avg(
        extract(epoch from (
          coalesce(l.cancelado_em, now()) - pp.primeira_compra
        )) / 86400
      ))::int as dias_ativo,
      sum(case when l.subscription_status = 'ativa' or
        (l.cancelado_em is null or l.cancelado_em > pp.primeira_compra + interval '30 days')
        then 1 else 0 end)::int as ativo_30d,
      sum(case when l.subscription_status = 'ativa' or
        (l.cancelado_em is null or l.cancelado_em > pp.primeira_compra + interval '90 days')
        then 1 else 0 end)::int as ativo_90d
    from primeiro_pagamento pp
    join leads l on l.id = pp.lead_id
    group by pp.metodo
    order by clientes desc
  `);

  return (result as unknown as Array<{
    metodo: string;
    clientes: number;
    dias_ativo: number;
    ativo_30d: number;
    ativo_90d: number;
  }>).map((r) => ({
    metodo: r.metodo as PaymentMethod,
    clientesUnicos: Number(r.clientes),
    diasMediosAtivo: Number(r.dias_ativo) || 0,
    taxaRetencao30d:
      r.clientes > 0 ? Number(r.ativo_30d) / Number(r.clientes) : 0,
    taxaRetencao90d:
      r.clientes > 0 ? Number(r.ativo_90d) / Number(r.clientes) : 0,
  }));
}
