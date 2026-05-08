/**
 * Sync incremental Ticto → Lead Tracker.
 *
 * Roda diariamente via cron. Estratégia:
 *  1. Orders das últimas 48h (filter[betweenDates]) — pega webhooks que falharam
 *  2. TODAS as subscriptions (são só ~234, rápido) — corrige status canceled/delayed
 *
 * NÃO dispara mensagens (igual backfill — só atualiza dados).
 */
import { db } from "../../db/client.js";
import { leads, eventos, type LeadStatus, type SubscriptionStatus } from "../../db/schema.js";
import { eq, or, sql } from "drizzle-orm";
import {
  getOrdersHistory,
  getSubscriptionsHistory,
  type TictoOrder,
  type TictoSubscription,
} from "./ticto-api.js";
import { upsertSubscription } from "./subscriptions.js";

type AnyObject = Record<string, unknown>;

function parsePhone(raw: unknown): string | null {
  if (!raw) return null;
  if (typeof raw === "object" && raw !== null) {
    const p = raw as AnyObject;
    const ddi = String(p.ddi ?? "").replace(/\D/g, "") || "55";
    const ddd = String(p.ddd ?? "").replace(/\D/g, "");
    const num = String(p.number ?? "").replace(/\D/g, "");
    if (!num) return null;
    return `${ddi}${ddd}${num}`;
  }
  return String(raw).replace(/\D/g, "") || null;
}

function parseDateBR(s: string): Date | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(
    Number(m[3]),
    Number(m[2]) - 1,
    Number(m[1]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6]),
  );
}

/** Primeira tx authorized da sub (data de adesão). null se nunca pagou. */
function firstPaidDate(sub: TictoSubscription): Date | null {
  const txs = ((sub as AnyObject).transactions as AnyObject[]) ?? [];
  const authorized = txs
    .filter((t) => String(t.status ?? "").toLowerCase() === "authorized")
    .map((t) => parseDateBR(String(t.created_at ?? "")))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());
  return authorized[0] ?? null;
}

/** Última tx authorized da sub (última renovação paga). null se nunca pagou. */
function lastPaidDate(sub: TictoSubscription): Date | null {
  const txs = ((sub as AnyObject).transactions as AnyObject[]) ?? [];
  const authorized = txs
    .filter((t) => String(t.status ?? "").toLowerCase() === "authorized")
    .map((t) => parseDateBR(String(t.created_at ?? "")))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime());
  return authorized[0] ?? null;
}

/**
 * Mapeia product.name da Ticto → produto_id do banco.
 *
 * Ticto é multi-produto (Gravyx, Web Designer, etc). Hardcode pra Gravyx
 * (id=1) classifica errado quando o cliente comprou outro produto. Mesma
 * regra do detectProdutoIdByPlano do asaas-sync.
 */
function detectProdutoIdByName(productName: string | undefined | null): number {
  if (!productName) return 1;
  const n = productName.toLowerCase();
  if (n.includes("gravyx")) return 1;
  if (n.includes("web designer")) return 13;
  if (n.includes("lucrando com foto")) return 14;
  if (n.includes("designer de prompt")) return 15;
  if (n.includes("pacote avulso")) return 16;
  if (n.includes("upward academy")) return 17; // Outros legado
  if (n.includes("arsenal")) return 17;
  return 17; // Outros (legado) por default — não joga em Gravyx
}

/** Próxima cobrança. Tenta sub.next_charge, fallback = lastPaid + interval meses. */
function nextChargeDate(sub: TictoSubscription, lastPaid: Date | null): Date | null {
  const o = sub as AnyObject;
  // Ticto pode usar várias chaves: next_charge, next_charge_at, next_payment_date
  const candidates = [o.next_charge, o.next_charge_at, o.next_payment_date].filter(Boolean);
  for (const c of candidates) {
    const s = String(c);
    const br = parseDateBR(s);
    if (br) return br;
    // tenta YYYY-MM-DD ou ISO
    const iso = new Date(s.length === 10 ? `${s}T12:00:00-03:00` : s);
    if (!Number.isNaN(iso.getTime())) return iso;
  }
  // Fallback: lastPaid + interval (1 mês mensal, 12 meses anual)
  if (lastPaid) {
    const interval = Number(o.interval ?? 1);
    const next = new Date(lastPaid);
    next.setMonth(next.getMonth() + interval);
    return next;
  }
  return null;
}

function mapTransactionStatus(order: TictoOrder): {
  eventType: string;
  leadStatus: LeadStatus;
  subStatus: SubscriptionStatus;
  pagouEm: Date | null;
} | null {
  const tx = order.transaction as AnyObject | undefined;
  const offer = order.offer as AnyObject | undefined;
  const status = String(tx?.status ?? "").toLowerCase();
  const occurrence = Number(tx?.occurrence ?? 0);
  const isSubscription = Boolean(offer?.is_subscription);
  const txDate = parseDateBR(String(tx?.created_at ?? ""));

  switch (status) {
    case "authorized":
      return {
        eventType: occurrence > 1 ? "assinatura_renovada" : "compra_aprovada",
        leadStatus: "cliente_ativo",
        subStatus: isSubscription ? "ativa" : "nenhuma",
        pagouEm: txDate,
      };
    case "refunded":
    case "chargeback":
      return {
        eventType: "reembolso",
        leadStatus: "cliente_em_risco",
        subStatus: "reembolsada",
        pagouEm: txDate,
      };
    case "refused":
      return {
        eventType: "compra_recusada",
        leadStatus: "pix_expirado",
        subStatus: "nenhuma",
        pagouEm: null,
      };
    case "delayed":
      return {
        eventType: occurrence > 1 ? "assinatura_atrasada" : "pix_gerado",
        leadStatus: occurrence > 1 ? "cliente_em_risco" : "pix_gerado",
        subStatus: occurrence > 1 ? "atrasada" : "aguardando_pagamento",
        pagouEm: null,
      };
    default:
      return null;
  }
}

function mapSubSituation(situation: string): {
  lead: LeadStatus;
  sub: SubscriptionStatus;
} | null {
  const s = situation.toLowerCase();
  if (s === "ativa" || s === "active") return { lead: "cliente_ativo", sub: "ativa" };
  if (s === "atrasada" || s === "delayed") return { lead: "cliente_em_risco", sub: "atrasada" };
  if (s === "cancelada" || s === "canceled" || s === "cancelled")
    return { lead: "cliente_cancelado", sub: "cancelada" };
  if (s === "reembolsada" || s === "refunded")
    return { lead: "cliente_em_risco", sub: "reembolsada" };
  // Checkout perdido: cliente tentou comprar mas 1ª cobrança falhou.
  // Não é "atrasada" (nunca foi ativo). Marca como pix_expirado/nenhuma —
  // é um lead quente pra remarketing, não assinante.
  if (s === "checkout_perdido") return { lead: "pix_expirado", sub: "nenhuma" };
  return null;
}

/**
 * Status real da sub. Distingue:
 *   - "atrasada": já foi ativo (successful_charges>0) e renovação falhou
 *   - "checkout_perdido": NUNCA ativou (1ª cobrança falhou — refused/pix expirou)
 *
 * Sem essa distinção, todos checkouts perdidos virariam "atrasada" no MRR
 * em risco, inflando contagem.
 */
function realSubStatus(sub: TictoSubscription): string {
  const txs = (sub as { transactions?: Array<{ status?: string; is_latest_transaction?: boolean }> }).transactions ?? [];
  const latest = txs.find((t) => t.is_latest_transaction) ?? txs[0];
  const successfulCharges = Number((sub as { successful_charges?: number }).successful_charges ?? 0);
  const jaFoiAtivo = successfulCharges > 0;
  if (latest?.status) {
    const s = String(latest.status).toLowerCase();
    if (s === "refunded" || s === "chargeback") return "reembolsada";
    if (s === "delayed" || s === "refused" || s === "waiting_payment" || s === "processing") {
      return jaFoiAtivo ? "atrasada" : "checkout_perdido";
    }
  }
  return String(sub.situation ?? sub.status ?? "");
}

/**
 * Processa 1 order. Retorna se foi created/updated/skipped.
 */
async function processOrder(order: TictoOrder): Promise<"created" | "updated" | "skipped"> {
  const customer = order.customer as AnyObject | undefined;
  const tx = order.transaction as AnyObject | undefined;
  const offer = order.offer as AnyObject | undefined;
  const product = order.product as AnyObject | undefined;
  const orderObj = order.order as AnyObject | undefined;

  const mapped = mapTransactionStatus(order);
  if (!mapped) return "skipped";

  const cpf = String(customer?.cpf ?? customer?.cnpj ?? "");
  const email = String(customer?.email ?? "");
  const phone = parsePhone(customer?.phone);
  const orderHash = String(orderObj?.hash ?? tx?.hash ?? "");

  // Já temos esse evento? Skip
  if (orderHash) {
    const exists = await db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from eventos
      where (source = 'ticto' or source = 'ticto-api-backfill' or source = 'ticto-sync')
        and payload->'order'->>'hash' = ${orderHash}
    `);
    if (Number((exists as unknown as Array<{ count: number }>)[0]?.count ?? 0) > 0) {
      return "skipped";
    }
  }

  let lead = await db.query.leads.findFirst({
    where: or(
      cpf ? eq(leads.gatewayCustomerId, cpf) : undefined,
      email ? eq(leads.email, email) : undefined,
      phone ? eq(leads.contato, phone) : undefined,
    ),
  });

  const planoNome = offer?.name
    ? `${product?.name ?? ""} ${offer.name}`.trim()
    : (product?.name as string | undefined) ?? "Sem plano";
  const valor =
    tx?.paid_amount && Number.isFinite(Number(tx.paid_amount))
      ? Number(tx.paid_amount) / 100
      : null;

  let action: "created" | "updated";
  if (!lead) {
    const [created] = await db
      .insert(leads)
      .values({
        nome: String(customer?.name ?? "Cliente Ticto"),
        email: email || null,
        contato: phone,
        tipo: "compra_aprovada",
        status: mapped.leadStatus,
        subscriptionStatus: mapped.subStatus,
        gateway: "ticto",
        gatewayCustomerId: cpf || null,
        gatewayLastOrderId: orderHash || null,
        planoNome,
        valorAssinatura: valor,
        pagouEm: mapped.pagouEm,
        atualizadoEm: new Date(),
        criadoEm: mapped.pagouEm ?? new Date(),
      })
      .returning();
    lead = created;
    action = "created";
  } else {
    const updates: Record<string, unknown> = {
      atualizadoEm: new Date(),
    };
    if (mapped.pagouEm && (!lead.pagouEm || mapped.pagouEm > lead.pagouEm)) {
      updates.pagouEm = mapped.pagouEm;
    }
    if (orderHash) updates.gatewayLastOrderId = orderHash;
    if (valor) updates.valorAssinatura = valor;
    // Sincroniza dados do cliente (Ticto = source of truth pra contato).
    // Só atualiza se Ticto tem valor não-vazio E diferente do atual,
    // pra não zerar dados quando payload vem incompleto.
    const tictoName = String(customer?.name ?? "").trim();
    if (tictoName && tictoName !== "Cliente Ticto" && tictoName !== lead.nome) {
      updates.nome = tictoName;
    }
    if (email && email.includes("@") && email !== lead.email) {
      updates.email = email;
    }
    if (phone && phone !== lead.contato) {
      updates.contato = phone;
    }
    await db.update(leads).set(updates).where(eq(leads.id, lead.id));
    action = "updated";
  }

  // Insere evento (não duplica — já checamos acima)
  await db.insert(eventos).values({
    leadId: lead.id,
    source: "ticto-sync",
    eventType: mapped.eventType,
    payload: order as AnyObject,
    processedOk: true,
    receivedAt: mapped.pagouEm ?? new Date(),
  });

  // Sincroniza a sub correspondente (1 row por lead+gateway).
  await upsertSubscription({
    leadId: lead.id,
    gateway: "ticto",
    status: mapped.subStatus,
    valor: valor ?? null,
    planoNome: planoNome ?? null,
    periodicidade: lead.periodicidade,
    produtoId: lead.produtoId ?? null,
    gatewaySubscriptionId: orderHash || null,
    gatewayCustomerId: cpf || null,
    pagouEm: mapped.pagouEm,
  });

  return action;
}

/**
 * Sync incremental — orders dos últimos N dias + todas subscriptions.
 */
export async function runTictoSync(daysOrdersBack = 2): Promise<{
  ordersCreated: number;
  ordersUpdated: number;
  ordersSkipped: number;
  subsUpdated: number;
  evCreated: number;
}> {
  // 1. Orders dos últimos N dias
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(today.getDate() - daysOrdersBack);

  const fmt = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;

  let ordersCreated = 0;
  let ordersUpdated = 0;
  let ordersSkipped = 0;

  let page = 1;
  while (true) {
    const resp = await getOrdersHistory(page, {
      betweenDates: `${fmt(fromDate)},${fmt(today)}`,
    });
    const orders = resp.data ?? [];
    if (orders.length === 0) break;
    for (const o of orders) {
      try {
        const r = await processOrder(o);
        if (r === "created") ordersCreated++;
        else if (r === "updated") ordersUpdated++;
        else ordersSkipped++;
      } catch (e) {
        console.error("[sync] order erro:", e instanceof Error ? e.message : e);
      }
    }
    const lastPage = resp.meta?.last_page ?? page;
    if (page >= lastPage) break;
    page++;
  }

  // 2. Subscriptions (todas — só ~234)
  let subsUpdated = 0;
  let evCreated = 0;
  let subsPage = 1;

  // Helper: cria eventos compra/refund pra cada transaction da sub Ticto.
  // Idempotente via order.hash (transaction.hash). Sem isso, faturamento
  // histórico fica zero porque o sync só cria 1 evento por sub (não por tx).
  async function syncTictoTransactions(leadId: number, sub: TictoSubscription) {
    const txs = ((sub as AnyObject).transactions as AnyObject[]) ?? [];
    const offer = sub.offer as AnyObject | undefined;
    const product = sub.product as AnyObject | undefined;
    const customer = sub.customer as AnyObject | undefined;
    const planoNome = offer?.name
      ? `${product?.name ?? ""} ${offer.name}`.trim()
      : (product?.name as string | undefined) ?? null;

    for (const tx of txs) {
      const txStatus = String(tx.status ?? "").toLowerCase();
      let eventType: string | null = null;
      if (txStatus === "authorized") eventType = "compra_aprovada";
      else if (txStatus === "refunded" || txStatus === "chargeback") eventType = "reembolso";
      else continue; // outros (delayed, refused, processing, waiting_payment) — não geram evento de receita

      const txHash = String(tx.hash ?? "");
      if (!txHash) continue;

      // Dedup: se já existe evento com mesmo transaction.hash, pula
      const exists = await db
        .select({ id: eventos.id })
        .from(eventos)
        .where(sql`${eventos.payload}->'transaction'->>'hash' = ${txHash}`)
        .limit(1);
      if (exists.length > 0) continue;

      // Data: tx.created_at no formato "DD/MM/YYYY HH:mm:ss"
      const dateStr = String(tx.created_at ?? "");
      const m = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/);
      const receivedAt = m
        ? new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}-03:00`)
        : new Date();

      // Valor: tx.paid_amount em centavos
      const valorCents = Number(tx.paid_amount ?? 0);

      await db.insert(eventos).values({
        leadId,
        produtoId: detectProdutoIdByName(product?.name as string | undefined),
        source: "ticto-sync",
        eventType,
        payload: {
          transaction: {
            hash: txHash,
            paid_amount: valorCents,
            payment_method: tx.payment_method,
            status: txStatus,
            occurrence: tx.occurrence,
          },
          offer: { name: offer?.name, price: offer?.price },
          product: { name: product?.name },
          item: { product_name: planoNome, amount: valorCents },
          customer: { name: customer?.name, email: customer?.email },
          order: { hash: txHash },
        },
        processedOk: true,
        receivedAt,
      });
      evCreated++;
    }
  }
  while (true) {
    const resp = await getSubscriptionsHistory(subsPage);
    const subs = resp.data ?? [];
    if (subs.length === 0) break;

    for (const sub of subs) {
      const customer = sub.customer as AnyObject | undefined;
      const cpf = String(customer?.cpf ?? customer?.cnpj ?? "");
      const email = String(customer?.email ?? "");
      const phones = customer?.phones as AnyObject[] | undefined;
      const phone = parsePhone(phones?.[0] ?? customer?.phone);
      const situation = realSubStatus(sub);
      const mapped = mapSubSituation(situation);
      if (!mapped) continue;

      let lead = await db.query.leads.findFirst({
        where: or(
          cpf ? eq(leads.gatewayCustomerId, cpf) : undefined,
          email ? eq(leads.email, email) : undefined,
          phone ? eq(leads.contato, phone) : undefined,
        ),
      });

      // Cria lead se não existe (assinante Ticto sem registro local)
      if (!lead) {
        if (!email && !phone && !cpf) continue;
        // Plano da Ticto: product.name + offer.name
        const offer = sub.offer as AnyObject | undefined;
        const product = sub.product as AnyObject | undefined;
        const planoNome = offer?.name
          ? `${product?.name ?? ""} ${offer.name}`.trim()
          : (product?.name as string | undefined) ?? "Sem plano";
        const valor = sub.price ? Number(sub.price) / 100 : null;
        const isAnnual = (sub as AnyObject).interval === 12;
        // Detecta produto pelo nome (Ticto vende Gravyx + outros produtos
        // do mesmo produtor — não pode hardcoded como Gravyx).
        const produtoId = detectProdutoIdByName(product?.name as string | undefined);
        // Datas REAIS da sub Ticto (NUNCA new Date()): firstPaidDate da
        // primeira tx authorized, lastPaidDate da última, nextCharge =
        // sub.next_charge ?? lastPaid+interval. Sem isso, calendário de
        // renovação fica todo no dia que sync rodou (bug das 209 subs).
        const firstPaid = firstPaidDate(sub);
        const lastPaid = lastPaidDate(sub);
        const nextCharge = nextChargeDate(sub, lastPaid);
        const [createdLead] = await db
          .insert(leads)
          .values({
            nome: String(customer?.name ?? "Cliente Ticto"),
            email: email || null,
            contato: phone,
            tipo: "compra_aprovada",
            status: mapped.lead,
            subscriptionStatus: mapped.sub,
            gateway: "ticto",
            gatewayCustomerId: cpf || null,
            produtoId,
            planoNome,
            valorAssinatura: valor,
            periodicidade: isAnnual ? "anual" : "mensal",
            pagouEm: firstPaid,
            ultimaRenovacaoEm: lastPaid,
            canceladoEm: mapped.sub === "cancelada" ? new Date() : null,
            atualizadoEm: new Date(),
            criadoEm: firstPaid ?? new Date(),
          })
          .returning();
        lead = createdLead;
        await upsertSubscription({
          leadId: lead.id,
          gateway: "ticto",
          status: mapped.sub,
          valor,
          planoNome,
          periodicidade: isAnnual ? "anual" : "mensal",
          produtoId,
          gatewayCustomerId: cpf || null,
          pagouEm: firstPaid,
          proximoPagamentoEm: nextCharge,
        });
        await syncTictoTransactions(lead.id, sub);
        subsUpdated++;
        continue;
      }

      // Gateway-aware: se lead está em outro gateway (ex: migrou pra
      // Stripe/Asaas), sub Ticto cancelada NÃO sobrescreve. Mesma regra
      // do flows.ts handleGatewayEvent — fix da Martha/Eduardo.
      if (lead.gateway && lead.gateway !== "ticto" && mapped.sub === "cancelada") {
        // Pula esta sub — cancelamento Ticto enquanto cliente está
        // ativo em outro gateway é cancelamento "lateral" (cliente
        // migrou e cancelou plano antigo).
        continue;
      }

      // Datas REAIS da sub (NUNCA NEW Date()): firstPaid pra calendário,
      // lastPaid pra ultimaRenovacaoEm, nextCharge pra próxima cobrança.
      const firstPaid = firstPaidDate(sub);
      const lastPaid = lastPaidDate(sub);
      const nextCharge = nextChargeDate(sub, lastPaid);
      const product = sub.product as AnyObject | undefined;
      const detectedProdutoId = detectProdutoIdByName(product?.name as string | undefined);

      const updates: Record<string, unknown> = {
        atualizadoEm: new Date(),
      };
      // Status/subscription só atualiza se mudou
      if (lead.status !== mapped.lead || lead.subscriptionStatus !== mapped.sub) {
        updates.status = mapped.lead;
        updates.subscriptionStatus = mapped.sub;
        if (mapped.sub === "cancelada" && !lead.canceladoEm) {
          updates.canceladoEm = new Date();
        }
      }
      // Reclassifica produto_id se sync detectou produto diferente
      // (corrige hardcode antigo que jogava tudo em Gravyx).
      if (detectedProdutoId !== lead.produtoId) {
        updates.produtoId = detectedProdutoId;
      }
      // Datas REAIS — corrige bug das 209 subs no calendário
      if (firstPaid && (!lead.pagouEm || firstPaid < lead.pagouEm)) {
        updates.pagouEm = firstPaid;
      }
      if (lastPaid && (!lead.ultimaRenovacaoEm || lastPaid > lead.ultimaRenovacaoEm)) {
        updates.ultimaRenovacaoEm = lastPaid;
      }
      // Sincroniza dados do cliente (Ticto = source of truth)
      const tictoName = String(customer?.name ?? "").trim();
      if (tictoName && tictoName !== "Cliente Ticto" && tictoName !== lead.nome) {
        updates.nome = tictoName;
      }
      if (email && email.includes("@") && email !== lead.email) {
        updates.email = email;
      }
      if (phone && phone !== lead.contato) {
        updates.contato = phone;
      }
      // Só faz update se há mais que atualizadoEm
      if (Object.keys(updates).length > 1) {
        await db.update(leads).set(updates).where(eq(leads.id, lead.id));
        subsUpdated++;
      }
      // Mantém a sub Ticto em sincronia (1 row por lead+gateway).
      // Não pula no caso do guard gateway-aware acima (cancel lateral): o
      // `continue` antes desse bloco já filtrou o caso problemático.
      await upsertSubscription({
        leadId: lead.id,
        gateway: "ticto",
        status: mapped.sub,
        valor: lead.valorAssinatura ?? null,
        planoNome: lead.planoNome ?? null,
        periodicidade: lead.periodicidade,
        produtoId: detectedProdutoId,
        gatewayCustomerId: cpf || null,
        pagouEm: firstPaid,
        proximoPagamentoEm: nextCharge,
      });
      // Cria eventos históricos das transações da sub (compras + reembolsos).
      // Idempotente — só cria o que não existe.
      await syncTictoTransactions(lead.id, sub);
    }

    const lastPage = resp.meta?.last_page ?? subsPage;
    if (subsPage >= lastPage) break;
    subsPage++;
  }

  return { ordersCreated, ordersUpdated, ordersSkipped, subsUpdated, evCreated };
}
