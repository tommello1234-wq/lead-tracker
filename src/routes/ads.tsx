import { useQuery } from "@tanstack/react-query";
import {
  Megaphone,
  MousePointerClick,
  ShoppingCart,
  DollarSign,
  TrendingUp,
  AlertCircle,
} from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToSince, PERIOD_LABELS } from "@/lib/period";
import { StatCard } from "@/components/stat-card";
import { ConversionFunnel } from "@/components/conversion-funnel";
import type { MetaInsights, MetaCampaign } from "@shared/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlSmall = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("pt-BR");
const pct = (n: number) => `${n.toFixed(2)}%`;

export function AdsPage() {
  const { period } = useProdutoContext();
  const since = periodToSince(period);
  // Meta UI's "últimos N dias" excludes today (so 7d = ontem-6 → ontem).
  // For period === "today", keep until = now to include partial day.
  const untilDate = new Date();
  if (period !== "today" && period !== "all") {
    untilDate.setDate(untilDate.getDate() - 1);
    untilDate.setHours(23, 59, 59, 999);
  }
  const sinceParam = since ? since.toISOString() : "";
  const untilParam = untilDate.toISOString();
  const qs = `since=${sinceParam}&until=${untilParam}`;

  const insights = useQuery({
    queryKey: ["meta-ads", "insights", sinceParam],
    queryFn: () => api.get<MetaInsights>(`/api/meta-ads/insights?${qs}`),
    retry: 0,
  });

  const campaigns = useQuery({
    queryKey: ["meta-ads", "campaigns", sinceParam],
    queryFn: () => api.get<MetaCampaign[]>(`/api/meta-ads/campaigns?${qs}`),
    retry: 0,
  });

  const i = insights.data;
  const cs = campaigns.data ?? [];
  const isError = insights.isError || campaigns.isError;
  const errorMsg = insights.error instanceof Error ? insights.error.message : null;

  return (
    <div className="space-y-5">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Meta Ads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Performance da conta CT 01 - Gravyx · {PERIOD_LABELS[period]}
          </p>
        </div>
      </header>

      {isError ? (
        <div className="card-soft p-6 border-destructive/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="size-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-destructive">Erro ao buscar dados Meta</p>
              <p className="text-sm text-muted-foreground mt-1">
                {errorMsg ?? "Token expirado ou conta não autorizada."}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                Token Meta dura ~2h. Pra renovar: gere novo no Graph Explorer (
                <code>ads_read</code>) e atualize <code>META_ACCESS_TOKEN</code> no Vercel.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {insights.isLoading ? (
        <div className="card-soft p-8 text-center text-sm text-muted-foreground">
          Carregando dados Meta...
        </div>
      ) : i ? (
        <>
          {/* KPIs principais */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Gasto"
              value={brl(i.spend)}
              hint={`CPM ${brlSmall(i.cpm)}`}
              icon={DollarSign}
              iconTone="forest"
            />
            <StatCard
              label="ROAS"
              value={i.roas > 0 ? `${i.roas.toFixed(2)}x` : "—"}
              hint={i.purchaseValue > 0 ? `R$ ${num(Math.round(i.purchaseValue))} receita` : "Sem receita atribuída"}
              icon={TrendingUp}
              iconTone={i.roas >= 3 ? "forest" : i.roas >= 1 ? "lime" : "rose"}
            />
            <StatCard
              label="CPA (custo por compra)"
              value={i.purchases > 0 ? brl(i.cpa) : "—"}
              hint={`${num(i.purchases)} compras (Pixel)`}
              icon={ShoppingCart}
              iconTone="lime"
            />
            <StatCard
              label="CPC (link)"
              value={brlSmall(i.cpc)}
              hint={`${num(i.clicks)} clicks · CTR ${pct(i.ctr)}`}
              icon={MousePointerClick}
              iconTone="lime"
            />
          </div>

          {/* Funil de conversão visual */}
          <ConversionFunnel insights={i} />

          {/* Tabela de campanhas */}
          <div className="card-soft overflow-hidden">
            <div className="px-5 py-4 border-b border-border flex items-center gap-3">
              <div className="size-9 rounded-2xl bg-lime-soft text-forest grid place-items-center">
                <Megaphone className="size-4" />
              </div>
              <div>
                <h3 className="font-semibold">Campanhas</h3>
                <p className="text-xs text-muted-foreground">
                  {cs.length} campanha{cs.length !== 1 ? "s" : ""} no período · ordenadas por gasto
                </p>
              </div>
            </div>

            {cs.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                Nenhuma campanha com gasto no período.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Campanha
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Gasto
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Clicks
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      CTR
                    </th>
                    <th className="text-right px-4 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      Compras
                    </th>
                    <th className="text-right px-5 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                      CPA
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...cs]
                    .sort((a, b) => b.spend - a.spend)
                    .map((c) => (
                      <tr
                        key={c.campaignId}
                        className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-5 py-3 font-medium truncate max-w-[400px]">
                          {c.campaignName}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{brl(c.spend)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {num(c.clicks)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                          {pct(c.ctr)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {c.purchases > 0 ? num(c.purchases) : "—"}
                        </td>
                        <td className="px-5 py-3 text-right tabular-nums">
                          {c.cpa != null ? (
                            <span
                              className={
                                c.cpa < (i.cpa || Infinity) * 0.8
                                  ? "text-forest font-semibold"
                                  : c.cpa > (i.cpa || 0) * 1.3
                                    ? "text-destructive font-semibold"
                                    : ""
                              }
                            >
                              {brl(c.cpa)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center">
            Dados via Meta Marketing API · Conta act_918344584462338 · Token temporário (renove no Graph Explorer quando expirar)
          </p>
        </>
      ) : null}
    </div>
  );
}
