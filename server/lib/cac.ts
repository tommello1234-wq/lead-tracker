import { db } from "../../db/client.js";
import { leads } from "../../db/schema.js";
import { and, eq, gte, lte, isNotNull, sql } from "drizzle-orm";
import { getInsights } from "./meta-ads.js";

export type CacMetrics = {
  adSpend: number;
  newCustomers: number;
  cac: number;
  pixelPurchases: number;
  cpaMeta: number;
  organicCount: number;
  organicPct: number;
};

/**
 * CAC blended: combina gasto Meta + total novos clientes Lead Tracker no período.
 * Diferente do CPA Meta (gasto / pixel attributed), o CAC inclui todos os novos
 * clientes pagantes — orgânico + tráfego pago + indicação — diluindo o custo.
 *
 * Atualmente Meta tracking é só pra Gravyx (act_918344584462338). Outros produtos
 * retornam adSpend=0 e cac=0; o frontend decide ocultar o card nesses casos.
 */
export async function getCacMetrics(
  produtoId: number | null,
  since: Date | null,
  until: Date | null,
): Promise<CacMetrics> {
  const effectiveUntil = until ?? new Date();
  const effectiveSince = since;

  const conds = [isNotNull(leads.pagouEm)];
  if (produtoId != null) conds.push(eq(leads.produtoId, produtoId));
  if (effectiveSince) conds.push(gte(leads.pagouEm, effectiveSince));
  conds.push(lte(leads.pagouEm, effectiveUntil));

  const [customerRow, meta] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(...conds))
      .then((r) => r[0]),
    getInsights(effectiveSince, effectiveUntil).catch(() => null),
  ]);

  const newCustomers = customerRow?.n ?? 0;
  const adSpend = meta?.spend ?? 0;
  const pixelPurchases = meta?.purchases ?? 0;
  const cpaMeta = meta?.cpa ?? 0;
  const cac = newCustomers > 0 ? adSpend / newCustomers : 0;
  const organicCount = Math.max(0, newCustomers - pixelPurchases);
  const organicPct = newCustomers > 0 ? (organicCount / newCustomers) * 100 : 0;

  return {
    adSpend,
    newCustomers,
    cac,
    pixelPurchases,
    cpaMeta,
    organicCount,
    organicPct,
  };
}
