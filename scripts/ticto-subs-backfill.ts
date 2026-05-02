/**
 * Backfill de subscriptions via API Ticto.
 * Atualiza APENAS o status do lead baseado no status real da subscription.
 * NÃO cria eventos (evita duplicar com orders/history) e NÃO dispara mensagens.
 *
 * Mapeamento Ticto subscription_status → nosso status:
 *   active   → cliente_ativo / ativa
 *   delayed  → cliente_em_risco / atrasada
 *   canceled → cliente_cancelado / cancelada
 *
 * Roda: node --env-file=.env.local --import tsx scripts/ticto-subs-backfill.ts [--dry]
 */
import { db } from "../db/client";
import { leads, type LeadStatus, type SubscriptionStatus } from "../db/schema";
import { eq, or } from "drizzle-orm";
import { getSubscriptionsHistory, type TictoSubscription } from "../server/lib/ticto-api";

const DRY = process.argv.includes("--dry");

type AnyObject = Record<string, unknown>;

function mapSubStatus(status: string): {
  lead: LeadStatus;
  sub: SubscriptionStatus;
} | null {
  const s = status.toLowerCase();
  if (s === "active" || s === "ativa") return { lead: "cliente_ativo", sub: "ativa" };
  if (s === "delayed" || s === "atrasada") return { lead: "cliente_em_risco", sub: "atrasada" };
  if (s === "canceled" || s === "cancelled" || s === "cancelada")
    return { lead: "cliente_cancelado", sub: "cancelada" };
  return null;
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
  return String(raw).replace(/\D/g, "") || null;
}

async function processSub(sub: TictoSubscription) {
  const customer = sub.customer as AnyObject | undefined;
  const cpf = String(customer?.cpf ?? customer?.cnpj ?? "");
  const email = String(customer?.email ?? "");
  // subscriptions API retorna phones[] (array), não phone object
  const phones = customer?.phones as AnyObject[] | undefined;
  const phone = parsePhone(phones?.[0] ?? customer?.phone);
  // subscriptions API usa "situation" (PT), não "status"
  const status = String(sub.situation ?? sub.status ?? "");

  const mapped = mapSubStatus(status);
  if (!mapped) return { skipped: true, reason: `status-unknown:${status}` };

  // Match lead por cpf > email > phone
  const lead = await db.query.leads.findFirst({
    where: or(
      cpf ? eq(leads.gatewayCustomerId, cpf) : undefined,
      email ? eq(leads.email, email) : undefined,
      phone ? eq(leads.contato, phone) : undefined,
    ),
  });

  if (!lead) return { skipped: true, reason: "lead-not-found" };

  // Se já tá com o status certo, skip
  if (lead.status === mapped.lead && lead.subscriptionStatus === mapped.sub) {
    return { skipped: true, reason: "already-correct" };
  }

  if (!DRY) {
    const updates: Record<string, unknown> = {
      status: mapped.lead,
      subscriptionStatus: mapped.sub,
    };
    // Cancelado: registra data
    if (mapped.sub === "cancelada" && !lead.canceladoEm) {
      updates.canceladoEm = new Date();
    }
    await db.update(leads).set(updates).where(eq(leads.id, lead.id));
  }

  return {
    skipped: false,
    leadId: lead.id,
    nome: lead.nome,
    from: `${lead.status}/${lead.subscriptionStatus}`,
    to: `${mapped.lead}/${mapped.sub}`,
  };
}

async function main() {
  console.log(`\n=== Subscriptions backfill ${DRY ? "(DRY)" : "(APPLY)"} ===\n`);
  let page = 1;
  let total = 0;
  let updated = 0;
  let skipped = 0;
  const sample: Array<{ from: string; to: string; nome: string }> = [];

  while (true) {
    process.stdout.write(`Página ${page}... `);
    const resp = await getSubscriptionsHistory(page);
    const subs = resp.data ?? [];
    if (subs.length === 0) {
      console.log("vazio.");
      break;
    }
    for (const s of subs) {
      const r = await processSub(s);
      total++;
      if (r.skipped) skipped++;
      else {
        updated++;
        if (sample.length < 8 && r.from && r.to)
          sample.push({ from: r.from, to: r.to, nome: r.nome ?? "-" });
      }
    }
    console.log(`${subs.length} processadas`);
    const meta = resp.meta;
    const lastPage = meta?.last_page ?? page;
    if (page >= lastPage) break;
    page++;
  }

  console.log(`\n=== Resumo ===`);
  console.log(`Total subs:    ${total}`);
  console.log(`Atualizados:   ${updated}`);
  console.log(`Sem mudança:   ${skipped}`);
  if (sample.length > 0) {
    console.log(`\nAmostra de mudanças:`);
    console.table(sample);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
