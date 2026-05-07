/**
 * Sync diário Asaas → Lead Tracker.
 *
 * Pega TODOS customers do Asaas e reconcilia com leads no banco.
 * Aplica regra "última subscription vale": se o customer tem múltiplas
 * subs, pega a mais recente. Status determinado pelo status da sub
 * + presença de pagamento recente.
 */
import { db } from "../../db/client.js";
import { leads, type LeadStatus, type SubscriptionStatus } from "../../db/schema.js";
import { eq, or } from "drizzle-orm";

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

function mapPlano(desc?: string): string | null {
  if (!desc) return null;
  if (/custom/i.test(desc)) return "Gravyx Creator";
  if (/starter/i.test(desc)) return "Gravyx Starter";
  if (/premium/i.test(desc)) return "Gravyx Premium";
  if (/enterprise/i.test(desc)) return "Gravyx Enterprise";
  if (/gravyx/i.test(desc)) return desc;
  return null;
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
  notFound: number;
  unchanged: number;
}> {
  const url = (process.env.ASAAS_API_URL ?? "https://api.asaas.com/v3").replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) throw new Error("ASAAS_API_KEY não configurada");

  // 1) Lista todos customers
  const customers: AsaasCust[] = [];
  let offset = 0;
  while (true) {
    const r = await fetch(`${url}/customers?limit=100&offset=${offset}`, { headers: { access_token: key } });
    if (!r.ok) throw new Error(`Asaas ${r.status}: ${await r.text()}`);
    const b = (await r.json()) as { data: AsaasCust[]; hasMore: boolean };
    customers.push(...b.data);
    if (!b.hasMore) break;
    offset += 100;
    if (offset > 5000) break;
  }

  const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
  let updated = 0, notFound = 0, unchanged = 0;

  for (const cust of customers) {
    // Subs do customer + payments
    const [sRes, pRes] = await Promise.all([
      fetch(`${url}/subscriptions?customer=${cust.id}&limit=20`, { headers: { access_token: key } }),
      fetch(`${url}/payments?customer=${cust.id}&limit=20`, { headers: { access_token: key } }),
    ]);
    const subsActive = ((await sRes.json()) as { data: AsaasSub[] }).data ?? [];
    const pays = ((await pRes.json()) as { data: AsaasPayment[] }).data ?? [];

    // Pega subs referenciadas em payments também
    const allSubs: AsaasSub[] = [...subsActive];
    for (const p of pays) {
      if (!p.subscription) continue;
      if (allSubs.some((s) => s.id === p.subscription)) continue;
      try {
        const r = await fetch(`${url}/subscriptions/${p.subscription}`, { headers: { access_token: key } });
        if (r.ok) allSubs.push((await r.json()) as AsaasSub);
      } catch { /* skip */ }
    }
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
    const onlyRefund = pays.length > 0 && pays.every((p) => /^REFUNDED$/i.test(p.status ?? ""));

    const mapped = mapStatus(lastSub?.status, recentPaid, onlyRefund);
    const valor = lastSub?.value ?? pays[0]?.value ?? 0;
    const planoNome = mapPlano(lastSub?.description ?? pays[0]?.description);

    const phone = normalizePhone(cust.mobilePhone ?? cust.phone);
    const email = normEmail(cust.email);
    const cpf = cust.cpfCnpj ?? null;

    // Match lead
    const lead = await db.query.leads.findFirst({
      where: or(
        phone ? eq(leads.contato, phone) : undefined,
        email ? eq(leads.email, email) : undefined,
        cpf ? eq(leads.gatewayCustomerId, cpf) : undefined,
      ),
    });
    if (!lead) { notFound++; continue; }

    const needsUpdate =
      lead.gateway !== "asaas" ||
      lead.subscriptionStatus !== mapped.sub ||
      lead.status !== mapped.lead ||
      (valor > 0 && lead.valorAssinatura !== valor);
    if (!needsUpdate) { unchanged++; continue; }

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
    if (mapped.sub === "cancelada" && !lead.canceladoEm) updates.canceladoEm = new Date();

    await db.update(leads).set(updates).where(eq(leads.id, lead.id));
    updated++;
  }

  return { totalCustomers: customers.length, updated, notFound, unchanged };
}
