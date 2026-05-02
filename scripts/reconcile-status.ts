/**
 * Reconcilia o status de cada lead baseado no ÚLTIMO evento real.
 * Limpa lixo de importação e PIX recorrente mal classificado.
 *
 * Roda: node --env-file=.env.local --import tsx scripts/reconcile-status.ts [--apply]
 * Sem --apply: dry-run (só mostra o que mudaria).
 * Com --apply: executa as mudanças.
 */
import { db } from "../db/client";
import { leads, type LeadStatus, type SubscriptionStatus } from "../db/schema";
import { sql, eq } from "drizzle-orm";
import { parseTictoWebhook } from "../server/lib/ticto";

const APPLY = process.argv.includes("--apply");

// Mapa evento → status (mesmo do flows.ts)
const STATUS_TRANSITIONS: Record<
  string,
  { lead: LeadStatus; subscription: SubscriptionStatus }
> = {
  carrinho_abandonado: { lead: "carrinho_abandonado", subscription: "nenhuma" },
  pix_gerado: { lead: "pix_gerado", subscription: "aguardando_pagamento" },
  pix_expirado: { lead: "pix_expirado", subscription: "nenhuma" },
  compra_aprovada: { lead: "cliente_ativo", subscription: "ativa" },
  compra_recusada: { lead: "pix_expirado", subscription: "nenhuma" },
  reembolso: { lead: "cliente_em_risco", subscription: "reembolsada" },
  assinatura_renovada: { lead: "cliente_ativo", subscription: "ativa" },
  assinatura_cancelada: { lead: "cliente_cancelado", subscription: "cancelada" },
  assinatura_atrasada: { lead: "cliente_em_risco", subscription: "atrasada" },
};

async function main() {
  console.log(`\n=== ${APPLY ? "APLICANDO" : "DRY-RUN"} reconciliação de status ===\n`);

  // Pega todos leads + último evento processado_ok
  const rows = await db.execute<{
    id: number;
    nome: string;
    status_atual: string;
    sub_atual: string;
    pagou_em: Date | null;
    last_event_type: string | null;
    last_payload: Record<string, unknown> | null;
  }>(sql`
    select
      l.id,
      l.nome,
      l.status as status_atual,
      l.subscription_status as sub_atual,
      l.pagou_em,
      (select event_type from eventos where lead_id = l.id and processed_ok = true
       order by received_at desc limit 1) as last_event_type,
      (select payload from eventos where lead_id = l.id and processed_ok = true
       order by received_at desc limit 1) as last_payload
    from leads l
    order by l.id
  `);

  type Row = {
    id: number;
    nome: string;
    status_atual: string;
    sub_atual: string;
    pagou_em: Date | null;
    last_event_type: string | null;
    last_payload: Record<string, unknown> | null;
  };

  let mudados = 0;
  let semEvento = 0;
  let okJa = 0;

  for (const r of rows as unknown as Row[]) {
    let novoStatus: LeadStatus;
    let novoSub: SubscriptionStatus;
    let motivo: string;

    if (!r.last_event_type) {
      // Sem evento real — importação pura. Decide pelo pagouEm.
      if (r.pagou_em) {
        novoStatus = "cliente_ativo";
        novoSub = "ativa";
        motivo = "import sem evento, mas tem pagou_em → cliente_ativo";
      } else {
        novoStatus = "lead_novo";
        novoSub = "nenhuma";
        motivo = "import sem evento e sem pagou_em → lead_novo";
      }
      semEvento++;
    } else {
      // Re-roda o parser pro último payload pra pegar o evento "limpo"
      // (cobre caso de subscription_delayed + successful_charges=0 → pix_gerado)
      const reparsed = r.last_payload
        ? parseTictoWebhook(r.last_payload)
        : null;
      const eventType = reparsed?.eventType ?? r.last_event_type;
      const transition = STATUS_TRANSITIONS[eventType];
      if (!transition) {
        console.log(`[skip] Lead ${r.id} (${r.nome}): evento "${eventType}" sem mapping`);
        continue;
      }
      novoStatus = transition.lead;
      novoSub = transition.subscription;
      motivo = `último evento: ${eventType}`;
    }

    if (r.status_atual === novoStatus && r.sub_atual === novoSub) {
      okJa++;
      continue;
    }

    console.log(
      `[change] #${String(r.id).padEnd(3)} ${(r.nome ?? "-").substring(0, 30).padEnd(30)} | ${r.status_atual.padEnd(20)} → ${novoStatus.padEnd(20)} | ${r.sub_atual.padEnd(12)} → ${novoSub.padEnd(12)} | ${motivo}`,
    );
    mudados++;

    if (APPLY) {
      await db
        .update(leads)
        .set({
          status: novoStatus,
          subscriptionStatus: novoSub,
          atualizadoEm: new Date(),
        })
        .where(eq(leads.id, r.id));
    }
  }

  console.log(`\n=== Resumo ===`);
  console.log(`Total leads:        ${(rows as unknown as Row[]).length}`);
  console.log(`Já estavam OK:      ${okJa}`);
  console.log(`Mudaram:            ${mudados}`);
  console.log(`  → sem evento:    ${semEvento}`);
  console.log(`\n${APPLY ? "✓ Mudanças aplicadas no banco." : "ℹ Dry-run. Rode com --apply pra aplicar."}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
