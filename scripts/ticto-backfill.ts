/**
 * Backfill histórico via API Ticto.
 *
 * Itera /v1/orders/history página por página. Pra cada order:
 *   - Cria/atualiza lead (matching por gateway_customer_id, email, cpf)
 *   - Insere registro em `eventos` com source='ticto-api-backfill'
 *   - NÃO dispara fluxo de mensagens (evita criar milhares de pendentes)
 *
 * Roda: node --env-file=.env.local --import tsx scripts/ticto-backfill.ts [--dry] [--max=10]
 *   --dry: não escreve nada, só mostra o que faria
 *   --max=N: para depois de N páginas (debug)
 */
import { db } from "../db/client";
import { leads, eventos, type LeadStatus, type SubscriptionStatus } from "../db/schema";
import { eq, sql } from "drizzle-orm";
import { getOrdersHistory, type TictoOrder } from "../server/lib/ticto-api";

const DRY = process.argv.includes("--dry");
const MAX_PAGES = (() => {
  const arg = process.argv.find((a) => a.startsWith("--max="));
  return arg ? Number(arg.slice(6)) : Infinity;
})();

type AnyObject = Record<string, unknown>;

/**
 * Mapeia status da Ticto API → nosso GatewayEvent + transição de status.
 */
function mapTransactionStatus(order: TictoOrder): {
  eventType: string;
  leadStatus: LeadStatus;
  subStatus: SubscriptionStatus;
  pagouEm: Date | null;
  isReimburso: boolean;
} | null {
  const tx = order.transaction as AnyObject | undefined;
  const offer = order.offer as AnyObject | undefined;
  const status = String(tx?.status ?? "").toLowerCase();
  const occurrence = Number(tx?.occurrence ?? 0);
  const isSubscription = Boolean(offer?.is_subscription);
  const createdAt = String(tx?.created_at ?? "");

  // Parse data brasileira (DD/MM/YYYY HH:mm:ss)
  const parseDate = (s: string): Date | null => {
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
  };
  const txDate = parseDate(createdAt);

  switch (status) {
    case "authorized":
      // Pago. Se é renovação (occurrence > 1) é assinatura_renovada, senão compra_aprovada
      return {
        eventType: occurrence > 1 ? "assinatura_renovada" : "compra_aprovada",
        leadStatus: "cliente_ativo",
        subStatus: isSubscription ? "ativa" : "nenhuma",
        pagouEm: txDate,
        isReimburso: false,
      };
    case "refunded":
    case "chargeback":
      return {
        eventType: "reembolso",
        leadStatus: "cliente_em_risco",
        subStatus: "reembolsada",
        pagouEm: txDate,
        isReimburso: true,
      };
    case "refused":
      return {
        eventType: "compra_recusada",
        leadStatus: "pix_expirado",
        subStatus: "nenhuma",
        pagouEm: null,
        isReimburso: false,
      };
    case "delayed":
      // Subscription_delayed: assinatura atrasada se já tinha pago, senão pix pendente
      return {
        eventType: occurrence > 1 ? "assinatura_atrasada" : "pix_gerado",
        leadStatus: occurrence > 1 ? "cliente_em_risco" : "pix_gerado",
        subStatus: occurrence > 1 ? "atrasada" : "aguardando_pagamento",
        pagouEm: null,
        isReimburso: false,
      };
    case "waiting_payment":
      return {
        eventType: "pix_gerado",
        leadStatus: "pix_gerado",
        subStatus: "aguardando_pagamento",
        pagouEm: null,
        isReimburso: false,
      };
    case "expired":
    case "pix_expired":
      return {
        eventType: "pix_expirado",
        leadStatus: "pix_expirado",
        subStatus: "nenhuma",
        pagouEm: null,
        isReimburso: false,
      };
    case "aborted":
    case "abandoned_cart":
      return {
        eventType: "carrinho_abandonado",
        leadStatus: "carrinho_abandonado",
        subStatus: "nenhuma",
        pagouEm: null,
        isReimburso: false,
      };
    default:
      return null;
  }
}

function parsePhone(raw: AnyObject["phone"]): string | null {
  if (!raw) return null;
  if (typeof raw === "object" && raw !== null) {
    const p = raw as AnyObject;
    const ddi = String(p.ddi ?? "").replace(/\D/g, "") || "55";
    const ddd = String(p.ddd ?? "").replace(/\D/g, "");
    const num = String(p.number ?? "").replace(/\D/g, "");
    if (!num) return null;
    return `${ddi}${ddd}${num}`;
  }
  const digits = String(raw).replace(/\D/g, "");
  return digits || null;
}

async function processOrder(order: TictoOrder) {
  const customer = order.customer as AnyObject | undefined;
  const tx = order.transaction as AnyObject | undefined;
  const offer = order.offer as AnyObject | undefined;
  const product = order.product as AnyObject | undefined;
  const orderObj = order.order as AnyObject | undefined;

  const mapped = mapTransactionStatus(order);
  if (!mapped) {
    return { skipped: true, reason: `status desconhecido: ${tx?.status}` };
  }

  const customerCpf = String(customer?.cpf ?? customer?.cnpj ?? "");
  const customerEmail = String(customer?.email ?? "");
  const customerPhone = parsePhone(customer?.phone);
  const customerName = String(customer?.name ?? "Cliente Ticto");
  const planoNome = String(
    offer?.name
      ? `${product?.name ?? ""} ${offer.name}`.trim()
      : product?.name ?? "Sem plano",
  );
  const valor =
    tx?.paid_amount && Number.isFinite(Number(tx.paid_amount))
      ? Number(tx.paid_amount) / 100
      : offer?.price && Number.isFinite(Number(offer.price))
        ? Number(offer.price) / 100
        : null;

  // findOrCreateLead — match por cpf/cnpj > email > phone
  let lead: typeof leads.$inferSelect | undefined;
  if (customerCpf) {
    lead = await db.query.leads.findFirst({
      where: eq(leads.gatewayCustomerId, customerCpf),
    });
  }
  if (!lead && customerEmail) {
    lead = await db.query.leads.findFirst({ where: eq(leads.email, customerEmail) });
  }
  if (!lead && customerPhone) {
    lead = await db.query.leads.findFirst({ where: eq(leads.contato, customerPhone) });
  }

  let action: "create" | "update";
  if (!lead) {
    action = "create";
    if (!DRY) {
      const orderHash = String(orderObj?.hash ?? tx?.hash ?? "");
      const [created] = await db
        .insert(leads)
        .values({
          nome: customerName,
          email: customerEmail || null,
          contato: customerPhone,
          tipo: "compra_aprovada",
          status: mapped.leadStatus,
          subscriptionStatus: mapped.subStatus,
          gateway: "ticto",
          gatewayCustomerId: customerCpf || null,
          gatewayLastOrderId: orderHash || null,
          planoNome,
          valorAssinatura: valor,
          pagouEm: mapped.pagouEm,
          atualizadoEm: new Date(),
          criadoEm: mapped.pagouEm ?? new Date(),
        })
        .returning();
      lead = created;
    }
  } else {
    action = "update";
    if (!DRY) {
      // Update only se o evento atual é mais recente que o último update
      const updates: AnyObject = {
        nome: lead.nome ?? customerName,
        email: lead.email ?? (customerEmail || null),
        contato: lead.contato ?? customerPhone,
        gateway: "ticto",
        gatewayLastOrderId: String(orderObj?.hash ?? tx?.hash ?? lead.gatewayLastOrderId ?? ""),
        planoNome: lead.planoNome ?? planoNome,
        valorAssinatura: valor ?? lead.valorAssinatura,
        atualizadoEm: new Date(),
      };
      if (mapped.pagouEm && (!lead.pagouEm || mapped.pagouEm > lead.pagouEm)) {
        updates.pagouEm = mapped.pagouEm;
      }
      // Status só atualizamos se for evento posterior — reconcile-status faz isso melhor depois
      await db.update(leads).set(updates).where(eq(leads.id, lead.id));
    }
  }

  // Insere evento de auditoria (não duplica se já tem mesmo gatewayLastOrderId)
  if (!DRY && lead) {
    const orderHash = String(orderObj?.hash ?? tx?.hash ?? "");
    // Verifica se já existe evento desse hash pra não duplicar
    const existingEvent = orderHash
      ? await db.execute<{ count: number }>(sql`
          select count(*)::int as count
          from eventos
          where source = 'ticto-api-backfill'
            and payload->'order'->>'hash' = ${orderHash}
        `)
      : null;
    const exists = existingEvent
      ? Number((existingEvent as unknown as Array<{ count: number }>)[0]?.count ?? 0) > 0
      : false;

    if (!exists) {
      await db.insert(eventos).values({
        leadId: lead.id,
        source: "ticto-api-backfill",
        eventType: mapped.eventType,
        payload: order as AnyObject,
        processedOk: true,
        receivedAt: mapped.pagouEm ?? new Date(),
      });
    }
  }

  return { skipped: false, action, eventType: mapped.eventType };
}

async function main() {
  console.log(`\n=== Ticto backfill ${DRY ? "(DRY-RUN)" : "(APPLY)"} ===\n`);

  let page = 1;
  let totalProcessed = 0;
  let totalCreated = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  while (page <= MAX_PAGES) {
    process.stdout.write(`Página ${page}... `);
    const resp = await getOrdersHistory(page);
    const orders = resp.data ?? [];
    if (orders.length === 0) {
      console.log("vazio.");
      break;
    }

    for (const order of orders) {
      try {
        const result = await processOrder(order);
        totalProcessed++;
        if (result.skipped) totalSkipped++;
        else if (result.action === "create") totalCreated++;
        else if (result.action === "update") totalUpdated++;
      } catch (e) {
        console.error(`\n  ERRO no order ${order.order_id}:`, e instanceof Error ? e.message : e);
      }
    }

    const meta = resp.meta;
    const lastPage = meta?.last_page ?? page;
    console.log(`${orders.length} orders processados (${page}/${lastPage})`);
    if (page >= lastPage) break;
    page++;
  }

  console.log(`\n=== Resumo ===`);
  console.log(`Total processado:  ${totalProcessed}`);
  console.log(`  Leads criados:   ${totalCreated}`);
  console.log(`  Leads update:    ${totalUpdated}`);
  console.log(`  Skipped:         ${totalSkipped}`);
  console.log(
    `\n${DRY ? "ℹ DRY-RUN. Rode sem --dry pra aplicar." : "✓ Backfill concluído. Rode reconcile-status.ts pra acertar os status finais."}`,
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
