import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToRange } from "@/lib/period";

type LeadRow = {
  id: number;
  nome: string | null;
  email: string | null;
  contato: string | null;
  gateway: string | null;
  valorAssinatura: number | null;
  planoNome: string | null;
  pagouEm: string | null;
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const fmtDate = (iso: string | null) => {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
};

const GATEWAY_TONE: Record<string, string> = {
  stripe: "bg-violet-100 text-violet-700",
  ticto: "bg-blue-100 text-blue-700",
  asaas: "bg-amber-100 text-amber-700",
  pagarme: "bg-emerald-100 text-emerald-700",
};

export function LpLeadsModal({
  lp,
  referrer,
  onClose,
  onLeadClick,
}: {
  lp: string;
  referrer: string | null;
  onClose: () => void;
  onLeadClick?: (id: number) => void;
}) {
  const { produtoId, period, customDate, customRange, gateway } = useProdutoContext();
  const { since, until } = periodToRange(period, customDate, customRange);
  const sinceParam = since ? since.toISOString() : "";
  const untilParam = until.toISOString();
  const produtoParam = produtoId ?? "all";
  const gatewayParam = gateway ?? "all";
  const refParam = referrer == null ? "(null)" : referrer;

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "vendas-por-lp-leads", produtoParam, sinceParam, untilParam, gatewayParam, lp, refParam],
    queryFn: () =>
      api.get<LeadRow[]>(
        `/api/dashboard/vendas-por-lp/leads?produtoId=${produtoParam}&since=${sinceParam}&until=${untilParam}&gateway=${gatewayParam}&lp=${encodeURIComponent(lp)}&referrer=${encodeURIComponent(refParam)}`,
      ),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const total = data?.reduce((s, r) => s + (r.valorAssinatura ?? 0), 0) ?? 0;
  const lpLabel = lp === "(sem LP rastreada)" ? lp : "/" + lp;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-card rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-start justify-between gap-4 p-5 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">
              Vendas via <span className="font-mono">{lpLabel}</span>
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {referrer && referrer !== "direct" ? `Referrer: ${referrer} · ` : ""}
              {data ? `${data.length} ${data.length === 1 ? "lead" : "leads"} · ${brl(total)} em MRR` : "carregando..."}
            </p>
          </div>
          <button onClick={onClose} className="size-8 grid place-items-center rounded-full hover:bg-muted transition-colors" title="Fechar">
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Carregando…</div>
          ) : !data || data.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Nenhuma venda encontrada nesse período.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-border">
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2 font-medium">Lead</th>
                  <th className="px-4 py-2 font-medium">Plano</th>
                  <th className="px-4 py-2 font-medium text-right">Valor</th>
                  <th className="px-4 py-2 font-medium">Pagou</th>
                  <th className="px-4 py-2 font-medium">Gateway</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {data.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-border/30 hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => onLeadClick?.(row.id)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-foreground truncate max-w-[200px]">{row.nome ?? "—"}</div>
                      <div className="text-xs text-muted-foreground truncate max-w-[200px]">{row.email ?? row.contato ?? "—"}</div>
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">{row.planoNome ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      {row.valorAssinatura != null ? brl(row.valorAssinatura) : "—"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground tabular-nums">{fmtDate(row.pagouEm)}</td>
                    <td className="px-4 py-2.5">
                      {row.gateway ? (
                        <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${GATEWAY_TONE[row.gateway] ?? "bg-muted text-muted-foreground"}`}>
                          {row.gateway}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2.5">
                      <ExternalLink className="size-3.5 text-muted-foreground/50" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
