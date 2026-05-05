/**
 * Métricas de movimentação de MRR no período (New / Expansion / Churn / etc).
 *
 * Lê da tabela `mrr_movements` (populada por flows.ts em cada evento relevante).
 * Net New MRR = soma de todos os movements no período = quanto o MRR mudou.
 */
import { db } from "../../db/client.js";
import { mrrMovements } from "../../db/schema.js";
import { and, eq, gte, lte, sql } from "drizzle-orm";

export type MrrMovementType =
  | "new"
  | "expansion"
  | "reactivation"
  | "contraction"
  | "churn"
  | "refund";

export type MrrMovementsBreakdown = {
  netNewMrr: number;
  byType: Record<MrrMovementType, { count: number; total: number }>;
};

const ZERO_BUCKETS: MrrMovementsBreakdown["byType"] = {
  new: { count: 0, total: 0 },
  expansion: { count: 0, total: 0 },
  reactivation: { count: 0, total: 0 },
  contraction: { count: 0, total: 0 },
  churn: { count: 0, total: 0 },
  refund: { count: 0, total: 0 },
};

export async function getMrrBreakdown(
  produtoId: number | null,
  since: Date | null,
  until: Date | null,
): Promise<MrrMovementsBreakdown> {
  const conds = [];
  if (produtoId != null) conds.push(eq(mrrMovements.produtoId, produtoId));
  if (since) conds.push(gte(mrrMovements.ocorridoEm, since));
  if (until) conds.push(lte(mrrMovements.ocorridoEm, until));

  const rows = (await db
    .select({
      type: mrrMovements.type,
      count: sql<number>`count(*)::int`,
      total: sql<number>`coalesce(sum(${mrrMovements.amount}), 0)::float`,
    })
    .from(mrrMovements)
    .where(conds.length > 0 ? and(...conds) : undefined)
    .groupBy(mrrMovements.type)) as Array<{
    type: string;
    count: number;
    total: number;
  }>;

  const byType: MrrMovementsBreakdown["byType"] = {
    ...ZERO_BUCKETS,
  };
  let netNewMrr = 0;
  for (const r of rows) {
    if (r.type in byType) {
      byType[r.type as MrrMovementType] = { count: r.count, total: r.total };
      netNewMrr += r.total;
    }
  }

  return { netNewMrr, byType };
}
