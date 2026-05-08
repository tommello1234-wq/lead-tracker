/**
 * Sync diário Asaas → Lead Tracker.
 *
 * Pega TODOS customers do Asaas e reconcilia com leads no banco.
 * Aplica regra "última subscription vale": se o customer tem múltiplas
 * subs, pega a mais recente. Status determinado pelo status da sub
 * + presença de pagamento recente.
 */
import { db } from "../../db/client.js";
import { leads, eventos, type LeadStatus, type SubscriptionStatus } from "../../db/schema.js";
import { eq, or, sql } from "drizzle-orm";
import { upsertSubscription } from "./subscriptions.js";

type AsaasCust = { id: string; name?: string; email?: string; phone?: string; mobilePhone?: string; cpfCnpj?: string };
type AsaasSub = { id: string; status: string; value: number; cycle: string; description?: string; dateCreated?: string };
type AsaasPayment = { id: string; status: string; value: number; subscription?: string; description?: string; dueDate: string; confirmedDate?: string; paymentDate?: string; dateCreated?: string };

function normalizePhone(raw?: string): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function normEmail(raw?: string): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (!t.includes("@") || !t.includes(".")) return null;
  return t;
}

function mapPlano(desc?: string, valor?: number): string | null {
  if (!desc) return null;
  if (/custom/i.test(desc)) return "Gravyx Creator";
  if (/starter/i.test(desc)) return "Gravyx Starter";
  if (/premium/i.test(desc)) return "Gravyx Premium";
  if (/enterprise/i.test(desc)) return "Gravyx Enterprise";
  if (/gravyx/i.test(desc)) return desc;
  // Asaas usa "Acesso à oferta Oferta Principal" como label genérico.
  // Quando valor é R$ 47 = Gravyx Creator (Pix), é o checkout PIX padrão.
  if (/oferta principal/i.test(desc) && valor === 47) return "Gravyx Creator (Pix)";
  return null;
}

/**
 * Mapeia descrição Asaas → produto_id do banco.
 * Default: 1 (Gravyx). Outros produtos detectados por keywords no plano.
 */
function detectProdutoIdByPlano(desc?: string, valor?: number): number {
  if (!desc) return 1;
  if (/web designer/i.test(desc)) return 13; // WDF
  if (/lucrando com foto/i.test(desc)) return 14; // LCFI
  if (/designer de prompt/i.test(desc)) return 15; // DP
  if (/pacote avulso/i.test(desc)) return 16; // Pacote Avulso
  // Oferta Principal R$47 = Gravyx Creator Pix; outros = Outros
  if (/oferta principal/i.test(desc) && valor !== 47) return 17; // Outros
  if (/parcela.*de/i.test(desc) && !/gravyx/i.test(desc)) return 17; // Outros parcelados
  return 1; // Gravyx (default)
}

function mapStatus(
  subStatus: string | undefined,
  hasRecentPaid: boolean,
  hasOnlyRefund: boolean,
): { lead: LeadStatus; sub: SubscriptionStatus } {
  if (!subStatus) {
    if (hasOnlyRefund) return { lead: "cliente_em_risco", sub: "reembolsada" };
    return { lead: "cliente_cancelado", sub: "cancelada" };
  }
  const s = subStatus.toUpperCase();
  if (s === "ACTIVE") {
    return hasRecentPaid
      ? { lead: "cliente_ativo", sub: "ativa" }
      : { lead: "cliente_em_risco", sub: "atrasada" };
  }
  return { lead: "cliente_cancelado", sub: "cancelada" };
}

export async function runAsaasSync(): Promise<{
  totalCustomers: number;
  updated: number;
  created: number;
  notFound: number;
  unchanged: number;
  evCreated: number;
}> {
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error("ASAAS_API_KEY não configurada");

  // Helper paginado
  async function listAll<T>(path: string): Promise<T[]> {
    const out: T[] = [];
    let offset = 0;
    while (true) {
      const r = await fetch(`${url}${path}${path.includes("?") ? "&" : "?"}limit=100&offset=${offset}`, {
        headers: { access_token: key },
      });
      if (!r.ok) {
        if (r.status === 429) { await new Promise(res => setTimeout(res, 2000)); continue; }
        break;
      }
      const b = (await r.json()) as { data: T[]; hasMore: boolean };
      out.push(...(b.data ?? []));
      if (!b.hasMore) break;
      offset += 100;
      if (offset > 10000) break;
      await new Promise(res => setTimeout(res, 200));
    }
    return out;
  }

  // 1) Pega TUDO globalmente (3-10 calls em vez de 1 por customer)
  const customers = await listAll<AsaasCust>("/customers");
  const allSubsGlobal = await listAll<AsaasSub & { customer: string }>("/subscriptions");
  const allPaysGlobal = await listAll<AsaasPayment & { customer: string }>("/payments");

  // Indexa por customer pra lookup O(1)
  const subsByCust = new Map<string, AsaasSub[]>();
  for (const s of allSubsGlobal) {
    if (!subsByCust.has(s.customer)) subsByCust.set(s.customer, []);
    subsByCust.get(s.customer)!.push(s);
  }
  const paysByCust = new Map<string, AsaasPayment[]>();
  for (const p of allPaysGlobal) {
    if (!paysByCust.has(p.customer)) paysByCust.set(p.customer, []);
    paysByCust.get(p.customer)!.push(p);
  }

  const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
  let updated = 0, created = 0, notFound = 0, unchanged = 0;
  let evCreated = 0;

  // Cria evento pra cada payment confirmado/refunded — necessário pro
  // Faturamento aparecer no dashboard. Idempotente via order_hash = payment.id.
  async function syncPaymentsAsEvents(leadId: number, produtoId: number, ps: AsaasPayment[]) {
    for (const p of ps) {
      const status = (p.status ?? "").toUpperCase();
      let eventType: string | null = null;
      if (status === "CONFIRMED" || status === "RECEIVED" || status === "RECEIVED_IN_CASH") {
        eventType = "compra_aprovada";
      } else if (status === "REFUNDED") {
        eventType = "reembolso";
      }
      if (!eventType) continue;

      // Dedup: se já existe evento com mesmo payment.id (em payload.order.hash), pula
      const existing = await db
        .select({ id: eventos.id })
        .from(eventos)
        .where(sql`${eventos.payload}->'order'->>'hash' = ${p.id}`)
        .limit(1);
      if (existing.length > 0) continue;

      const dateStr = p.confirmedDate ?? p.paymentDate ?? p.dueDate;
      const receivedAt = dateStr ? new Date(dateStr) : new Date();

      await db.insert(eventos).values({
        leadId,
        produtoId,
        source: "asaas-sync",
        eventType,
        payload: {
          payment: { value: p.value, description: p.description, status },
          order: { hash: p.id },
        },
        processedOk: true,
        receivedAt,
      });
      evCreated++;
    }
  }

  for (const cust of customers) {
    const allSubs = subsByCust.get(cust.id) ?? [];
    const pays = paysByCust.get(cust.id) ?? [];

    const hasPaid = pays.some((p) => /^(CONFIRMED|RECEIVED|RECEIVED_IN_CASH|REFUNDED)$/i.test(p.status ?? ""));
    if (allSubs.length === 0 && !hasPaid) { notFound++; continue; }

    // Última sub
    const lastSub = allSubs.sort((a, b) => (b.dateCreated ?? "").localeCompare(a.dateCreated ?? ""))[0];
    const recentPaid = pays.some((p) => {
      const st = (p.status ?? "").toUpperCase();
      if (st !== "CONFIRMED" && st !== "RECEIVED" && st !== "RECEIVED_IN_CASH") return false;
      const d = new Date(p.confirmedDate ?? p.paymentDate ?? p.dueDate);
      return d.getTime() > cutoff;
    });

    // Data REAL do último pagamento confirmado (pra calendário de renovação ficar certo)
    const paidPays = pays.filter((p) => /^(CONFIRMED|RECEIVED|RECEIVED_IN_CASH)$/i.test(p.status ?? ""));
    const lastPaidDate = paidPays
      .map((p) => new Date(p.confirmedDate ?? p.paymentDate ?? p.dueDate))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    // Data da PRIMEIRA compra confirmada (pagouEm canônico)
    const firstPaidDate = paidPays
      .map((p) => new Date(p.confirmedDate ?? p.paymentDate ?? p.dueDate))
      .filter((d) => !Number.isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const onlyRefund = pays.length > 0 && pays.every((p) => /^REFUNDED$/i.test(p.status ?? ""));

    const mapped = mapStatus(lastSub?.status, recentPaid, onlyRefund);
    const valor = lastSub?.value ?? pays[0]?.value ?? 0;
    const planoDesc = lastSub?.description ?? pays[0]?.description;
    const planoNome = mapPlano(planoDesc, valor);
    const detectedProdutoId = detectProdutoIdByPlano(planoDesc, valor);

    const phone = normalizePhone(cust.mobilePhone ?? cust.phone);
    const email = normEmail(cust.email);
    const cpf = cust.cpfCnpj ?? null;

    // Match lead
    let lead = await db.query.leads.findFirst({
      where: or(
        phone ? eq(leads.contato, phone) : undefined,
        email ? eq(leads.email, email) : undefined,
        cpf ? eq(leads.gatewayCustomerId, cpf) : undefined,
      ),
    });

    // Cria lead se não existe (assinatura Asaas sem registro local)
    if (!lead) {
      if (!email && !phone && !cpf) { notFound++; continue; }
      const [createdLead] = await db
        .insert(leads)
        .values({
          nome: cust.name ?? "Cliente Asaas",
          email,
          contato: phone,
          tipo: "compra_aprovada",
          status: mapped.lead,
          subscriptionStatus: mapped.sub,
          gateway: "asaas",
          gatewayCustomerId: cpf,
          gatewayLastOrderId: lastSub?.id ?? null,
          produtoId: detectedProdutoId,
          planoNome,
          valorAssinatura: valor > 0 ? valor : null,
          pagouEm: firstPaidDate,
          ultimaRenovacaoEm: lastPaidDate,
          canceladoEm: mapped.sub === "cancelada" ? new Date() : null,
          atualizadoEm: new Date(),
        })
        .returning();
      lead = createdLead;
      await upsertSubscription({
        leadId: lead.id,
        gateway: "asaas",
        status: mapped.sub,
        valor: valor > 0 ? valor : null,
        planoNome,
        periodicidade: "mensal",
        produtoId: detectedProdutoId,
        gatewaySubscriptionId: lastSub?.id ?? null,
        gatewayCustomerId: cpf,
        pagouEm: firstPaidDate,
        ultimaRenovacaoEm: lastPaidDate,
      });
      await syncPaymentsAsEvents(lead.id, detectedProdutoId, pays);
      created++;
      continue;
    }

    const needsUpdate =
      lead.gateway !== "asaas" ||
      lead.subscriptionStatus !== mapped.sub ||
      lead.status !== mapped.lead ||
      (valor > 0 && lead.valorAssinatura !== valor);
    // Mesmo se lead não mudou, sincroniza eventos de payments (pode ter
    // novos payments desde o último sync — ou faltou criar pra leads antigos)
    if (!needsUpdate) {
      await syncPaymentsAsEvents(lead.id, lead.produtoId ?? detectedProdutoId, pays);
      unchanged++;
      continue;
    }

    const updates: Record<string, unknown> = {
      gateway: "asaas",
      gatewayCustomerId: cpf ?? lead.gatewayCustomerId,
      gatewayLastOrderId: lastSub?.id ?? lead.gatewayLastOrderId,
      status: mapped.lead,
      subscriptionStatus: mapped.sub,
      atualizadoEm: new Date(),
    };
    if (valor > 0) updates.valorAssinatura = valor;
    if (planoNome) updates.planoNome = planoNome;
    // Atualiza produto_id se o plano detectado é diferente do produto atual
    // (ex: cliente comprou WDF mas tava em Gravyx por bug do sync antigo).
    if (detectedProdutoId !== lead.produtoId) {
      updates.produtoId = detectedProdutoId;
    }
    if (mapped.sub === "cancelada" && !lead.canceladoEm) updates.canceladoEm = new Date();
    // Atualiza pagouEm pra data REAL (não NOW()) — pra calendário de renovação
    if (firstPaidDate && !lead.pagouEm) updates.pagouEm = firstPaidDate;
    if (lastPaidDate) updates.ultimaRenovacaoEm = lastPaidDate;

    await db.update(leads).set(updates).where(eq(leads.id, lead.id));
    // Mantém sub Asaas em sincronia
    await upsertSubscription({
      leadId: lead.id,
      gateway: "asaas",
      status: mapped.sub,
      valor: valor > 0 ? valor : (lead.valorAssinatura ?? null),
      planoNome: planoNome ?? lead.planoNome ?? null,
      periodicidade: lead.periodicidade,
      produtoId: detectedProdutoId,
      gatewaySubscriptionId: lastSub?.id ?? null,
      gatewayCustomerId: cpf ?? null,
      pagouEm: firstPaidDate,
      ultimaRenovacaoEm: lastPaidDate,
    });
    await syncPaymentsAsEvents(lead.id, detectedProdutoId, pays);
    updated++;
  }

  return { totalCustomers: customers.length, updated, created, notFound, unchanged, evCreated };
}
