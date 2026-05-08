/**
 * Sync diário Stripe → Lead Tracker.
 *
 * Pega TODAS as subscriptions Stripe (active + canceled + past_due + ...)
 * e reconcilia com leads no banco. Webhook é best-effort; sync diário
 * garante consistência mesmo se um webhook falhou.
 */
import { db } from "../../db/client.js";
import { leads, eventos, type LeadStatus, type SubscriptionStatus } from "../../db/schema.js";
import { eq, or, sql } from "drizzle-orm";
import { upsertSubscription } from "./subscriptions.js";

type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  current_period_end: number;
  canceled_at?: number | null;
  items: { data: Array<{ price: { unit_amount: number; recurring?: { interval: string } } }> };
  metadata?: Record<string, string>;
};

type StripeCustomer = {
  id: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
};

function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const d = raw.replace(/\D/g, "");
  if (!d) return null;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function mapStripeStatus(status: string): { lead: LeadStatus; sub: SubscriptionStatus } {
  switch (status) {
    case "active":
    case "trialing":
      return { lead: "cliente_ativo", sub: "ativa" };
    case "past_due":
    case "unpaid":
      return { lead: "cliente_em_risco", sub: "atrasada" };
    case "canceled":
    case "incomplete_expired":
      return { lead: "cliente_cancelado", sub: "cancelada" };
    case "incomplete":
      return { lead: "cliente_em_risco", sub: "aguardando_pagamento" };
    default:
      return { lead: "cliente_em_risco", sub: "atrasada" };
  }
}

function mapPlanoFromSlug(slug?: string): string | null {
  if (!slug) return null;
  if (/studio/i.test(slug)) return "Gravyx Studio";
  if (/creator/i.test(slug)) return "Gravyx Creator";
  if (/starter/i.test(slug)) return "Gravyx Starter";
  // "Premium" foi renomeado pra Studio — mantém slug antigo apontando pra Studio.
  if (/premium/i.test(slug)) return "Gravyx Studio";
  return null;
}

type StripeInvoice = {
  id: string;
  customer: string;
  subscription?: string | null;
  amount_paid: number;
  amount_due: number;
  status: string; // paid, open, void, uncollectible, draft
  description?: string | null;
  status_transitions?: { paid_at?: number | null };
  lines?: { data: Array<{ description?: string | null; price?: { unit_amount?: number } }> };
};

type StripeRefund = {
  id: string;
  amount: number;
  charge: string;
  payment_intent?: string | null;
  status: string;
  created: number;
};

type StripeCharge = {
  id: string;
  customer?: string | null;
  invoice?: string | null;
  amount: number;
  refunded: boolean;
  amount_refunded: number;
};

export async function runStripeSync(): Promise<{
  total: number;
  updated: number;
  created: number;
  notFound: number;
  unchanged: number;
  evCreated: number;
}> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY não configurada");

  // Helper paginado Stripe
  async function listAllStripe<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = [];
    let starting_after: string | undefined;
    while (true) {
      const p = new URLSearchParams({ limit: "100", ...params });
      if (starting_after) p.set("starting_after", starting_after);
      const r = await fetch(`https://api.stripe.com/v1${path}?${p}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!r.ok) throw new Error(`Stripe ${path} ${r.status}: ${await r.text()}`);
      const body = (await r.json()) as { data: T[]; has_more: boolean };
      out.push(...body.data);
      if (!body.has_more || body.data.length === 0) break;
      starting_after = (body.data[body.data.length - 1] as { id: string }).id;
      if (out.length > 5000) break;
    }
    return out;
  }

  // 1) Pega todas subscriptions, invoices, charges, refunds (1x cada — sem rate-limit)
  const subs = await listAllStripe<StripeSubscription>("/subscriptions", { status: "all" });
  const allInvoices = await listAllStripe<StripeInvoice>("/invoices", { status: "paid" });
  const allCharges = await listAllStripe<StripeCharge>("/charges");
  const allRefunds = await listAllStripe<StripeRefund>("/refunds");
  // Index refunds por charge — pra pegar data real do refund (refund.created)
  const refundsByCharge = new Map<string, StripeRefund>();
  for (const rf of allRefunds) {
    // Pega o refund mais antigo de cada charge (1ª data de estorno)
    const existing = refundsByCharge.get(rf.charge);
    if (!existing || rf.created < existing.created) {
      refundsByCharge.set(rf.charge, rf);
    }
  }

  // Index invoices/charges por customer
  const invoicesByCust = new Map<string, StripeInvoice[]>();
  for (const inv of allInvoices) {
    if (!invoicesByCust.has(inv.customer)) invoicesByCust.set(inv.customer, []);
    invoicesByCust.get(inv.customer)!.push(inv);
  }
  const chargesByCust = new Map<string, StripeCharge[]>();
  for (const ch of allCharges) {
    if (!ch.customer) continue;
    if (!chargesByCust.has(ch.customer)) chargesByCust.set(ch.customer, []);
    chargesByCust.get(ch.customer)!.push(ch);
  }

  // 2) Pra cada sub, busca customer e atualiza/cria lead
  let updated = 0;
  let created = 0;
  let notFound = 0;
  let unchanged = 0;
  let evCreated = 0;

  // Cria eventos compra_aprovada/reembolso pra cada invoice paga / refund.
  // Idempotente via order.hash = invoice.id ou charge.id.
  async function syncStripeEvents(
    leadId: number,
    produtoId: number,
    customerId: string,
  ) {
    const invs = invoicesByCust.get(customerId) ?? [];
    const charges = chargesByCust.get(customerId) ?? [];

    for (const inv of invs) {
      if (inv.status !== "paid") continue;
      const exists = await db
        .select({ id: eventos.id })
        .from(eventos)
        .where(sql`${eventos.payload}->'order'->>'hash' = ${inv.id}`)
        .limit(1);
      if (exists.length > 0) continue;
      const dt = inv.status_transitions?.paid_at
        ? new Date(inv.status_transitions.paid_at * 1000)
        : new Date();
      const desc = inv.lines?.data?.[0]?.description ?? inv.description ?? "Stripe";
      await db.insert(eventos).values({
        leadId,
        produtoId,
        source: "stripe-sync",
        eventType: "compra_aprovada",
        payload: {
          payment: { value: inv.amount_paid / 100, description: desc, status: "paid" },
          order: { hash: inv.id },
        },
        processedOk: true,
        receivedAt: dt,
      });
      evCreated++;
    }

    // Refunds: charges com refunded=true. Data real vem de refund.created
    // (não new Date() — senão evento aparece como "hoje" mesmo se foi antigo).
    for (const ch of charges) {
      if (!ch.refunded || ch.amount_refunded === 0) continue;
      const refKey = `refund_${ch.id}`;
      const exists = await db
        .select({ id: eventos.id })
        .from(eventos)
        .where(sql`${eventos.payload}->'order'->>'hash' = ${refKey}`)
        .limit(1);
      if (exists.length > 0) continue;
      const refund = refundsByCharge.get(ch.id);
      const refundDate = refund ? new Date(refund.created * 1000) : new Date();
      await db.insert(eventos).values({
        leadId,
        produtoId,
        source: "stripe-sync",
        eventType: "reembolso",
        payload: {
          payment: { value: ch.amount_refunded / 100, status: "refunded" },
          order: { hash: refKey },
        },
        processedOk: true,
        receivedAt: refundDate,
      });
      evCreated++;
    }
  }
  for (const sub of subs) {
    // Customer info
    const cRes = await fetch(`https://api.stripe.com/v1/customers/${sub.customer}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!cRes.ok) { notFound++; continue; }
    const cust = (await cRes.json()) as StripeCustomer;

    const phone = normalizePhone(cust.phone);
    const email = cust.email?.toLowerCase() ?? null;

    // Match lead por email/phone/customer_id
    let lead = await db.query.leads.findFirst({
      where: or(
        email ? eq(leads.email, email) : undefined,
        phone ? eq(leads.contato, phone) : undefined,
        eq(leads.gatewayCustomerId, sub.customer),
      ),
    });

    const mappedNew = mapStripeStatus(sub.status);
    const valorNew = (sub.items.data[0]?.price.unit_amount ?? 0) / 100;
    const slugNew = sub.metadata?.gravyx_slug ?? sub.metadata?.slug;
    const planoNew = mapPlanoFromSlug(slugNew);

    // Cria lead se não existe (cliente Stripe sem registro local).
    // Ignora subs sem email/phone/customer válido (evita lead lixo).
    if (!lead) {
      if (!email && !phone && !sub.customer) { notFound++; continue; }
      // Stripe = só Gravyx (id=1) atualmente — única conta com Stripe conectado.
      const PRODUTO_GRAVYX = 1;
      const [createdLead] = await db
        .insert(leads)
        .values({
          nome: cust.name ?? "Cliente Stripe",
          email,
          contato: phone,
          tipo: "compra_aprovada",
          status: mappedNew.lead,
          subscriptionStatus: mappedNew.sub,
          gateway: "stripe",
          gatewayCustomerId: sub.customer,
          gatewayLastOrderId: sub.id,
          produtoId: PRODUTO_GRAVYX,
          planoNome: planoNew,
          valorAssinatura: valorNew > 0 ? valorNew : null,
          pagouEm: sub.canceled_at ? null : new Date(sub.current_period_end * 1000 - 30 * 24 * 60 * 60 * 1000),
          canceladoEm: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
          atualizadoEm: new Date(),
        })
        .returning();
      lead = createdLead;
      await upsertSubscription({
        leadId: lead.id,
        gateway: "stripe",
        status: mappedNew.sub,
        valor: valorNew > 0 ? valorNew : null,
        planoNome: planoNew,
        periodicidade: "mensal",
        produtoId: PRODUTO_GRAVYX,
        gatewaySubscriptionId: sub.id,
        gatewayCustomerId: sub.customer,
        canceladoEm: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
      });
      await syncStripeEvents(lead.id, PRODUTO_GRAVYX, sub.customer);
      created++;
      continue;
    }

    const mapped = mapStripeStatus(sub.status);
    const valor = (sub.items.data[0]?.price.unit_amount ?? 0) / 100;
    const slug = sub.metadata?.gravyx_slug ?? sub.metadata?.slug;
    const planoNome = mapPlanoFromSlug(slug) ?? lead.planoNome;

    // Só atualiza se algo mudou
    const needsUpdate =
      lead.status !== mapped.lead ||
      lead.subscriptionStatus !== mapped.sub ||
      lead.gateway !== "stripe" ||
      (valor > 0 && lead.valorAssinatura !== valor);
    if (!needsUpdate) {
      await syncStripeEvents(lead.id, lead.produtoId ?? 1, sub.customer);
      unchanged++;
      continue;
    }

    const updates: Record<string, unknown> = {
      gateway: "stripe",
      gatewayLastOrderId: sub.id,
      status: mapped.lead,
      subscriptionStatus: mapped.sub,
      atualizadoEm: new Date(),
    };
    if (valor > 0) updates.valorAssinatura = valor;
    if (planoNome) updates.planoNome = planoNome;
    if (mapped.sub === "cancelada" && !lead.canceladoEm) {
      updates.canceladoEm = sub.canceled_at ? new Date(sub.canceled_at * 1000) : new Date();
    }
    if (cust.email && !lead.email) updates.email = cust.email.toLowerCase();
    if (phone && !lead.contato) updates.contato = phone;

    await db.update(leads).set(updates).where(eq(leads.id, lead.id));
    // Mantém sub Stripe em sincronia
    await upsertSubscription({
      leadId: lead.id,
      gateway: "stripe",
      status: mapped.sub,
      valor: valor > 0 ? valor : (lead.valorAssinatura ?? null),
      planoNome: planoNome ?? lead.planoNome ?? null,
      periodicidade: lead.periodicidade,
      produtoId: lead.produtoId ?? null,
      gatewaySubscriptionId: sub.id,
      gatewayCustomerId: sub.customer,
      canceladoEm: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    });
    await syncStripeEvents(lead.id, lead.produtoId ?? 1, sub.customer);
    updated++;
  }

  return { total: subs.length, updated, created, notFound, unchanged, evCreated };
}
