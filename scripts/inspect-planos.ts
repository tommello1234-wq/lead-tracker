/**
 * Lista os planos do Gravyx e calcula LTV por plano (creator, studio, etc).
 */
import { db } from "../db/client.js";
import { leads } from "../db/schema.js";
import { eq, and, isNotNull } from "drizzle-orm";

async function main() {
  const all = await db.select().from(leads).where(eq(leads.produtoId, 1));
  console.log(`Total leads Gravyx: ${all.length}\n`);

  // Agrupa por plano
  type Plano = {
    nome: string;
    total: number;
    ativos: number;
    cancelados: number;
    avgTicket: number;
    avgLifespanCancelados: number;
    ltv: number;
    mrr: number;
  };
  const planos = new Map<string, Plano>();

  for (const l of all) {
    const nome = (l.planoNome ?? "Sem plano").trim() || "Sem plano";
    let p = planos.get(nome);
    if (!p) {
      p = {
        nome,
        total: 0,
        ativos: 0,
        cancelados: 0,
        avgTicket: 0,
        avgLifespanCancelados: 0,
        ltv: 0,
        mrr: 0,
      };
      planos.set(nome, p);
    }
    p.total++;
    if (l.subscriptionStatus === "ativa") {
      p.ativos++;
      p.mrr += l.valorAssinatura ?? 0;
    }
    if (l.canceladoEm && l.pagouEm) {
      p.cancelados++;
      const months =
        (l.canceladoEm.getTime() - l.pagouEm.getTime()) /
        (30 * 24 * 60 * 60 * 1000);
      // Acumula pra média depois
      p.avgLifespanCancelados += months;
    }
    if (l.valorAssinatura) p.avgTicket += l.valorAssinatura;
  }

  // Calcula médias e LTV por plano
  for (const p of planos.values()) {
    p.avgTicket = p.total > 0 ? p.avgTicket / p.total : 0;
    p.avgLifespanCancelados =
      p.cancelados > 0 ? p.avgLifespanCancelados / p.cancelados : 0;
    const arpu = p.ativos > 0 ? p.mrr / p.ativos : p.avgTicket;
    p.ltv = arpu * p.avgLifespanCancelados;
  }

  const sorted = Array.from(planos.values()).sort((a, b) => b.total - a.total);
  console.log(
    `${"Plano".padEnd(35)} | ${"Total".padStart(5)} | ${"Ativos".padStart(6)} | ${"Cancel".padStart(6)} | ${"ARPU".padStart(8)} | ${"Vida".padStart(8)} | ${"LTV".padStart(8)} | MRR`,
  );
  console.log("-".repeat(120));
  for (const p of sorted) {
    const arpu = p.ativos > 0 ? p.mrr / p.ativos : p.avgTicket;
    console.log(
      `${p.nome.slice(0, 35).padEnd(35)} | ${String(p.total).padStart(5)} | ${String(p.ativos).padStart(6)} | ${String(p.cancelados).padStart(6)} | R$ ${arpu.toFixed(2).padStart(5)} | ${p.avgLifespanCancelados.toFixed(2).padStart(4)}m | R$ ${p.ltv.toFixed(0).padStart(4)} | R$ ${p.mrr.toFixed(0)}`,
    );
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
