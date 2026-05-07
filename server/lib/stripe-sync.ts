/**
 * Sync diário Stripe → Lead Tracker.
 *
 * Pega TODAS as subscriptions Stripe (active + canceled + past_due + ...)
 * e reconcilia com leads no banco. Webhook é best-effort; sync diário
 * garante consistência mesmo se um webhook falhou.
 */
import { db } from "../../db/client.js";
import { leads, type LeadStatus, type SubscriptionStatus } from "../../db/schema.js";
import { eq, or } from "drizzle-orm";
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
  if (/premium/i.test(slug)) return "Gravyx Premium";
  return null;
}

export async function runStripeSync(): Promise<{
  total: number;
  updated: number;
  notFound: number;
  unchanged: number;
}> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY não configurada");

  // 1) Pega todas subscriptions paginadas (status=all)
  const subs: StripeSubscription[] = [];
  let starting_after: string | undefined;
  while (true) {
    const params = new URLSearchParams({ status: "all", limit: "100" });
    if (starting_after) params.set("starting_after", starting_after);
    const r = await fetch(`https://api.stripe.com/v1/subscriptions?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) throw new Error(`Stripe ${r.status}: ${await r.text()}`);
    const body = (await r.json()) as { data: StripeSubscription[]; has_more: boolean };
    subs.push(...body.data);
    if (!body.has_more || body.data.length === 0) break;
    starting_after = body.data[body.data.length - 1].id;
    if (subs.length > 5000) break;
  }

  // 2) Pra cada sub, busca customer e atualiza lead
  let updated = 0;
  let notFound = 0;
  let unchanged = 0;
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
    const lead = await db.query.leads.findFirst({
      where: or(
        email ? eq(leads.email, email) : undefined,
        phone ? eq(leads.contato, phone) : undefined,
        eq(leads.gatewayCustomerId, sub.customer),
      ),
    });
    if (!lead) { notFound++; continue; }

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
    if (!needsUpdate) { unchanged++; continue; }

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
    updated++;
  }

  return { total: subs.length, updated, notFound, unchanged };
}
