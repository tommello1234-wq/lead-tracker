import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Target, Sparkles, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToRange, PERIOD_LABELS } from "@/lib/period";
import { LeadDetailsModal } from "@/components/lead-details-modal";

type Venda = {
  eventoId: number;
  leadId: number | null;
  pagouEm: string;
  nome: string | null;
  email: string | null;
  plano: string | null;
  valor: number;
  gateway: string | null;
  lpOrigem: string | null;
  referrer: string | null;
  src: string | null;
  cmp: string | null;
  adset: string | null;
  ad: string | null;
  temFbp: boolean;
  temFbc: boolean;
};

type Criativo = {
  cmp: string | null;
  adset: string | null;
  ad: string | null;
  vendas: number;
  receita: number;
  ticket: number;
};

type Resp = { vendas: Venda[]; porCriativo: Criativo[] };

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const GATEWAY_TONE: Record<string, string> = {
  stripe: "bg-violet-100 text-violet-700",
  ticto: "bg-blue-100 text-blue-700",
  asaas: "bg-amber-100 text-amber-700",
  pagarme: "bg-emerald-100 text-emerald-700",
};

export function AtribuicaoPage() {
  const { produtoId, period, customDate, customRange, gateway } = useProdutoContext();
  const { since, until } = periodToRange(period, customDate, customRange);
  const sinceParam = since ? since.toISOString() : "";
  const untilParam = until.toISOString();
  const produtoParam = produtoId ?? "all";
  const gatewayParam = gateway ?? "all";
  const [selectedLead, setSelectedLead] = useState<number | null>(null);
  const [filterCmp, setFilterCmp] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["atribuicao", produtoParam, sinceParam, untilParam, gatewayParam],
    queryFn: () =>
      api.get<Resp>(
        `/api/dashboard/atribuicao?produtoId=${produtoParam}&since=${sinceParam}&until=${untilParam}&gateway=${gatewayParam}`,
      ),
    retry: 1,
  });

  const totals = useMemo(() => {
    if (!data) return { vendas: 0, receita: 0, comAd: 0, semAd: 0 };
    let comAd = 0;
    let semAd = 0;
    let receita = 0;
    for (const v of data.vendas) {
      receita += v.valor;
      if (v.cmp || v.ad) comAd++;
      else semAd++;
    }
    return { vendas: data.vendas.length, receita, comAd, semAd };
  }, [data]);

  const vendasFiltradas = useMemo(() => {
    if (!data) return [];
    if (!filterCmp) return data.vendas;
    return data.vendas.filter((v) => v.cmp === filterCmp);
  }, [data, filterCmp]);

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="size-10 rounded-2xl bg-forest/10 grid place-items-center">
            <Target className="size-5 text-forest" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Atribuição detalhada</h1>
            <p className="text-sm text-muted-foreground">
              Cada venda + qual criativo/campanha o nosso rastreio interno capturou — {PERIOD_LABELS[period].toLowerCase()}
            </p>
          </div>
        </div>
      </header>

      {/* Cards de totais */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Vendas no período" value={String(totals.vendas)} />
        <SummaryCard label="Receita total" value={brl(totals.receita)} />
        <SummaryCard label="Com atribuição de ad" value={String(totals.comAd)} hint="cri tem cmp/adset/ad" />
        <SummaryCard label="Sem atribuição" value={String(totals.semAd)} hint="orgânico/direto/Ticto" />
      </div>

      {error ? (
        <div className="p-6 rounded-2xl border border-rose-500/30 bg-rose-50/30 text-sm text-rose-700">
          ❌ Erro ao carregar: {error instanceof Error ? error.message : "desconhecido"}
        </div>
      ) : isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Carregando…</div>
      ) : !data ? null : (
        <>
          {/* Top criativos */}
          <section className="card-soft p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <Sparkles className="size-4 text-forest" />
                  Vendas por criativo (rastreio interno)
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Apenas vendas em que o cliente clicou no ad → LP → checkout na mesma sessão (mais preciso que last-click do Meta)
                </p>
              </div>
              {filterCmp && (
                <button onClick={() => setFilterCmp(null)} className="text-xs text-blue-500 hover:underline">
                  Limpar filtro
                </button>
              )}
            </div>

            {data.porCriativo.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                Nenhuma venda com atribuição de ad nesse período.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <tr>
                      <th className="pb-2 pr-3">Campanha</th>
                      <th className="pb-2 pr-3">Conjunto</th>
                      <th className="pb-2 pr-3">Criativo</th>
                      <th className="pb-2 pr-3 text-right">Vendas</th>
                      <th className="pb-2 pr-3 text-right">Receita</th>
                      <th className="pb-2 pr-3 text-right">Ticket médio</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.porCriativo.map((c, i) => (
                      <tr
                        key={`${c.cmp}-${c.adset}-${c.ad}-${i}`}
                        className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                        onClick={() => setFilterCmp(c.cmp ?? null)}
                      >
                        <td className="py-2.5 pr-3 max-w-[200px] truncate" title={c.cmp ?? ""}>
                          {c.cmp ?? "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-muted-foreground">{c.adset ?? "—"}</td>
                        <td className="py-2.5 pr-3 font-medium max-w-[260px] truncate" title={c.ad ?? ""}>
                          {c.ad ?? "—"}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums font-semibold">{c.vendas}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-forest">{brl(c.receita)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">{brl(c.ticket)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Tabela de vendas individuais */}
          <section className="card-soft p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-semibold">Vendas individuais</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {filterCmp ? `Filtrando: ${filterCmp}` : `${vendasFiltradas.length} vendas · clique numa linha pra ver detalhes do lead`}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border sticky top-0 bg-card">
                  <tr>
                    <th className="pb-2 pr-3">Hora</th>
                    <th className="pb-2 pr-3">Cliente</th>
                    <th className="pb-2 pr-3">Plano</th>
                    <th className="pb-2 pr-3 text-right">Valor</th>
                    <th className="pb-2 pr-3">Gateway</th>
                    <th className="pb-2 pr-3">LP</th>
                    <th className="pb-2 pr-3">Referrer</th>
                    <th className="pb-2 pr-3">Campanha</th>
                    <th className="pb-2 pr-3">Criativo</th>
                    <th className="pb-2 pr-3">Cookies</th>
                  </tr>
                </thead>
                <tbody>
                  {vendasFiltradas.map((v) => (
                    <tr
                      key={v.eventoId}
                      className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                      onClick={() => v.leadId && setSelectedLead(v.leadId)}
                    >
                      <td className="py-2 pr-3 tabular-nums text-xs text-muted-foreground whitespace-nowrap">
                        {dateFmt.format(new Date(v.pagouEm))}
                      </td>
                      <td className="py-2 pr-3 max-w-[180px] truncate">
                        <div className="font-medium">{v.nome ?? "—"}</div>
                        <div className="text-xs text-muted-foreground truncate">{v.email ?? ""}</div>
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{v.plano ?? "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums font-semibold">{brl(v.valor)}</td>
                      <td className="py-2 pr-3">
                        {v.gateway && (
                          <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full ${GATEWAY_TONE[v.gateway] ?? "bg-muted text-muted-foreground"}`}>
                            {v.gateway}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs font-mono text-muted-foreground max-w-[140px] truncate" title={v.lpOrigem ?? ""}>
                        {v.lpOrigem ? `/${v.lpOrigem}` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">{v.referrer ?? "—"}</td>
                      <td className="py-2 pr-3 max-w-[180px] truncate" title={v.cmp ?? ""}>
                        {v.cmp ? <span className="text-foreground">{v.cmp}</span> : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="py-2 pr-3 max-w-[200px] truncate font-medium" title={v.ad ?? ""}>
                        {v.ad ? <span className="text-forest">{v.ad}</span> : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        <span className={`text-[10px] mr-1 ${v.temFbp ? "text-forest" : "text-muted-foreground/40"}`} title="fbp cookie">fbp</span>
                        <span className={`text-[10px] ${v.temFbc ? "text-forest" : "text-muted-foreground/40"}`} title="fbc cookie">fbc</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Aviso sobre Meta */}
          <div className="mt-6 p-4 rounded-2xl border border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10 flex items-start gap-3">
            <AlertCircle className="size-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-foreground/80">
              <strong>Próxima fase:</strong> coluna de "atribuição Meta" lado-a-lado pra comparar com o nosso CRI.
              Por enquanto, esse painel mostra <strong>só o nosso rastreio interno</strong> — quem clicou no ad → entrou na LP → comprou na mesma sessão.
              É mais preciso que o last-click do Meta (que pode dar crédito a ad clicado dias antes).
            </div>
          </div>
        </>
      )}

      {selectedLead !== null && (
        <LeadDetailsModal leadId={selectedLead} onClose={() => setSelectedLead(null)} />
      )}
    </div>
  );
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card-soft p-4">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{hint}</p>}
    </div>
  );
}
