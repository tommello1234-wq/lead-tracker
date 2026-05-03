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
async function _getCacMetrics(
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

/**
 * Cache 5min — Meta API com date_preset=maximum demora 5-15s. Sem cache,
 * cada refresh do dashboard puxa de novo. Com cache, primeira é lenta,
 * próximas são instantâneas.
 *
 * Cache key normalizada por minuto (não por dia) — passamos as Dates ORIGINAIS
 * pra `_getCacMetrics`, mas o key do cache é `cac:produtoId:sinceMin:untilMin`,
 * arredondando pro minuto pra que refreshes seguidos batam cache. Sem isso,
 * cada milissegundo de "until=NOW" geraria entry novo.
 */
const memCache = new Map<string, { value: CacMetrics; expiresAt: number }>();

export async function getCacMetrics(
  produtoId: number | null,
  since: Date | null,
  until: Date | null,
): Promise<CacMetrics> {
  // Arredonda pra minuto pra ter chave estável (refreshes em 1min batem cache)
  const sinceMin = since ? Math.floor(since.getTime() / 60_000) : "all";
  const untilMin = until ? Math.floor(until.getTime() / 60_000) : "now";
  const key = `cac:${produtoId ?? "all"}:${sinceMin}:${untilMin}`;
  const now = Date.now();
  const cached = memCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const value = await _getCacMetrics(produtoId, since, until);
  memCache.set(key, { value, expiresAt: now + 300_000 });
  return value;
}
