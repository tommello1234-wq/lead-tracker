import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  Megaphone,
  MousePointerClick,
  ShoppingCart,
  DollarSign,
  TrendingUp,
  AlertCircle,
  ExternalLink,
  Image as ImageIcon,
  Link2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToRange, PERIOD_LABELS } from "@/lib/period";
import { StatCard } from "@/components/stat-card";
import { ConversionFunnel } from "@/components/conversion-funnel";
import { VerticalFunnel } from "@/components/vertical-funnel";
import type { MetaInsights, MetaCampaign, CampaignStatus, Produto } from "@shared/types";

// Produtos com conta Meta conectada. Hoje só Gravyx (id=1, act_918344584462338).
// Quando outros produtos ganharem ad accounts, mover pra coluna no DB.
const PRODUTOS_COM_META = new Set<number>([1]);

const STATUS_LABELS: Record<CampaignStatus, string> = {
  ACTIVE: "Ativa",
  PAUSED: "Pausada",
  CAMPAIGN_PAUSED: "Pausada",
  ARCHIVED_BY_USER: "Arquivada",
  ARCHIVED: "Arquivada",
  DELETED: "Deletada",
  PENDING_REVIEW: "Em revisão",
  PREAPPROVED: "Pré-aprovada",
  DISAPPROVED: "Reprovada",
  PENDING_BILLING_INFO: "Sem billing",
  IN_PROCESS: "Processando",
  WITH_ISSUES: "Com problema",
  UNKNOWN: "—",
};

type SortKey =
  | "campaignName"
  | "spend"
  | "clicks"
  | "cpc"
  | "ctr"
  | "initiateCheckout"
  | "purchases"
  | "purchaseValue"
  | "roas"
  | "cpa";

function SortHeader({
  label,
  sortKey,
  current,
  onClick,
  align = "right",
}: {
  label: string;
  sortKey: SortKey;
  current: { key: SortKey; dir: "asc" | "desc" };
  onClick: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const isActive = current.key === sortKey;
  const Icon = !isActive ? ArrowUpDown : current.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <th
      className={`text-${align} px-3 py-3 font-medium text-foreground/70 text-xs uppercase tracking-wider`}
    >
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-foreground transition-colors ${align === "right" ? "" : ""} ${isActive ? "text-foreground" : ""}`}
      >
        {label}
        <Icon className={`size-3 ${isActive ? "" : "opacity-40"}`} />
      </button>
    </th>
  );
}

function StatusDot({ status }: { status: CampaignStatus }) {
  const isActive = status === "ACTIVE";
  const isPaused =
    status === "PAUSED" ||
    status === "CAMPAIGN_PAUSED" ||
    status === "ARCHIVED" ||
    status === "ARCHIVED_BY_USER";
  const isError =
    status === "DISAPPROVED" ||
    status === "WITH_ISSUES" ||
    status === "PENDING_BILLING_INFO";
  const color = isActive
    ? "bg-lime-deep"
    : isPaused
      ? "bg-foreground/30"
      : isError
        ? "bg-destructive"
        : "bg-amber-500";
  return (
    <span
      title={STATUS_LABELS[status] ?? status}
      className={`size-2 rounded-full shrink-0 ${color} ${isActive ? "animate-pulse" : ""}`}
    />
  );
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlSmall = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n: number) => n.toLocaleString("pt-BR");
const pct = (n: number) => `${n.toFixed(2)}%`;

export function AdsPage() {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "spend",
    dir: "desc",
  });
  const { produtoId, period, customDate } = useProdutoContext();
  const { since, until } = useMemo(
    () => periodToRange(period, customDate),
    [period, customDate],
  );
  const sinceParam = since ? since.toISOString() : "";
  const untilParam = until.toISOString();
  const qs = `since=${sinceParam}&until=${untilParam}`;

  // Só consulta Meta se o produto selecionado tem ad account conectado
  // (ou se for "Todos" — assume que pelo menos um produto tem)
  const hasMeta = produtoId == null || PRODUTOS_COM_META.has(produtoId);

  const produtos = useQuery({
    queryKey: ["produtos"],
    queryFn: () => api.get<Produto[]>("/api/produtos"),
    staleTime: 5 * 60 * 1000,
  });
  const produtoSel = produtos.data?.find((p) => p.id === produtoId);

  const insights = useQuery({
    queryKey: ["meta-ads", "insights", sinceParam],
    queryFn: () => api.get<MetaInsights>(`/api/meta-ads/insights?${qs}`),
    retry: 0,
    enabled: hasMeta,
  });

  const campaigns = useQuery({
    queryKey: ["meta-ads", "campaigns", sinceParam],
    queryFn: () => api.get<MetaCampaign[]>(`/api/meta-ads/campaigns?${qs}`),
    retry: 0,
    enabled: hasMeta,
  });

  const i = insights.data;
  const cs = campaigns.data ?? [];

  const toggleSort = (k: SortKey) => {
    setSort((prev) =>
      prev.key === k
        ? { key: k, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key: k, dir: "desc" },
    );
  };

  const sortedCampaigns = useMemo(() => {
    const arr = [...cs];
    arr.sort((a, b) => {
      const dir = sort.dir === "desc" ? -1 : 1;
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" && typeof bv === "string") {
        return av.localeCompare(bv) * dir;
      }
      const an = (av ?? 0) as number;
      const bn = (bv ?? 0) as number;
      return (an - bn) * dir;
    });
    return arr;
  }, [cs, sort]);
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

      {!hasMeta ? (
        <div className="card-soft p-12 text-center">
          <div className="size-16 rounded-2xl bg-lime-soft text-forest grid place-items-center mx-auto mb-4">
            <Link2 className="size-7" />
          </div>
          <h3 className="text-lg font-semibold mb-1">
            Conta Meta não conectada
          </h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto mb-4">
            O produto <strong>{produtoSel?.nome ?? "selecionado"}</strong> ainda
            não tem uma conta de anúncio Meta vinculada. Hoje só o Gravyx tem
            tracking ativo.
          </p>
          <p className="text-xs text-muted-foreground">
            Pra conectar: vincule o produto a uma conta Meta Ads no
            Business Manager e cadastre o ID no Lead Tracker.
          </p>
        </div>
      ) : isError ? (
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
      ) : insights.isLoading ? (
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

          {/* Funil de conversão: cards detalhados (60%) + visual (40%) */}
          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4 items-stretch">
            <ConversionFunnel insights={i} />
            <VerticalFunnel insights={i} />
          </div>

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
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <SortHeader label="Campanha" sortKey="campaignName" current={sort} onClick={toggleSort} align="left" />
                    <SortHeader label="Gasto" sortKey="spend" current={sort} onClick={toggleSort} />
                    <SortHeader label="Clicks" sortKey="clicks" current={sort} onClick={toggleSort} />
                    <SortHeader label="CPC" sortKey="cpc" current={sort} onClick={toggleSort} />
                    <SortHeader label="CTR" sortKey="ctr" current={sort} onClick={toggleSort} />
                    <SortHeader label="IC" sortKey="initiateCheckout" current={sort} onClick={toggleSort} />
                    <SortHeader label="Compras" sortKey="purchases" current={sort} onClick={toggleSort} />
                    <SortHeader label="Receita" sortKey="purchaseValue" current={sort} onClick={toggleSort} />
                    <SortHeader label="ROAS" sortKey="roas" current={sort} onClick={toggleSort} />
                    <SortHeader label="CPA" sortKey="cpa" current={sort} onClick={toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {sortedCampaigns.map((c) => (
                      <tr
                        key={c.campaignId}
                        className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                      >
                        <td className="px-5 py-3 font-medium max-w-[400px]">
                          <div className="flex items-center gap-2">
                            <StatusDot status={c.status} />
                            <span className="truncate">{c.campaignName}</span>
                            <div className="flex items-center gap-1 ml-1 shrink-0">
                              {c.landingPageUrl ? (
                                <a
                                  href={c.landingPageUrl}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  title={`Abrir LP: ${c.landingPageUrl}`}
                                  className="size-6 rounded-md grid place-items-center text-muted-foreground hover:text-forest hover:bg-lime-soft transition-colors"
                                >
                                  <ExternalLink className="size-3.5" />
                                </a>
                              ) : null}
                              {c.sampleAdId ? (
                                <a
                                  href={`https://business.facebook.com/adsmanager/manage/ads?act=918344584462338&selected_ad_ids=${c.sampleAdId}`}
                                  target="_blank"
                                  rel="noreferrer noopener"
                                  title="Ver criativo no Ads Manager"
                                  className="size-6 rounded-md grid place-items-center text-muted-foreground hover:text-forest hover:bg-lime-soft transition-colors"
                                >
                                  <ImageIcon className="size-3.5" />
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{brl(c.spend)}</td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                          {num(c.clicks)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                          {c.cpc > 0 ? brlSmall(c.cpc) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                          {pct(c.ctr)}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums text-muted-foreground">
                          {c.initiateCheckout > 0 ? num(c.initiateCheckout) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {c.purchases > 0 ? num(c.purchases) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {c.purchaseValue > 0 ? brl(c.purchaseValue) : "—"}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {c.roas > 0 ? (
                            <span
                              className={
                                c.roas >= 3
                                  ? "text-forest font-semibold"
                                  : c.roas < 1
                                    ? "text-destructive font-semibold"
                                    : ""
                              }
                            >
                              {c.roas.toFixed(2)}x
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
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
              </div>
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
