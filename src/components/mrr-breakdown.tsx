import { TrendingUp, TrendingDown, RefreshCcw, UserPlus, UserMinus, AlertOctagon } from "lucide-react";
import type { MrrMovementsBreakdown } from "@shared/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const brlSigned = (n: number) => (n >= 0 ? `+${brl(n)}` : `−${brl(Math.abs(n))}`);

/**
 * Waterfall do MRR no período: mostra quanto entrou (new, expansion,
 * reactivation) vs quanto saiu (churn, refund, contraction), terminando
 * em Net New MRR.
 */
export function MrrBreakdown({
  data,
  isLoading,
}: {
  data: MrrMovementsBreakdown | undefined;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="card-soft p-6">
        <p className="text-sm text-muted-foreground">Carregando MRR...</p>
      </div>
    );
  }
  if (!data) return null;

  const { netNewMrr, byType } = data;
  const positives = byType.new.total + byType.expansion.total + byType.reactivation.total;
  const negatives = byType.churn.total + byType.refund.total + byType.contraction.total;

  // Linhas do breakdown — só mostra as que têm movimento
  const rows: Array<{
    key: string;
    label: string;
    icon: typeof TrendingUp;
    iconClass: string;
    count: number;
    amount: number;
    positive: boolean;
  }> = [
    {
      key: "new",
      label: "New MRR",
      icon: UserPlus,
      iconClass: "bg-lime-soft text-forest",
      count: byType.new.count,
      amount: byType.new.total,
      positive: true,
    },
    {
      key: "expansion",
      label: "Expansion",
      icon: TrendingUp,
      iconClass: "bg-lime-soft text-forest",
      count: byType.expansion.count,
      amount: byType.expansion.total,
      positive: true,
    },
    {
      key: "reactivation",
      label: "Reativação",
      icon: RefreshCcw,
      iconClass: "bg-lime-soft text-forest",
      count: byType.reactivation.count,
      amount: byType.reactivation.total,
      positive: true,
    },
    {
      key: "contraction",
      label: "Downgrade",
      icon: TrendingDown,
      iconClass: "bg-[oklch(0.95_0.05_85)] text-[oklch(0.55_0.18_75)]",
      count: byType.contraction.count,
      amount: byType.contraction.total,
      positive: false,
    },
    {
      key: "churn",
      label: "Churn",
      icon: UserMinus,
      iconClass: "bg-[oklch(0.95_0.03_25)] text-[oklch(0.55_0.18_25)]",
      count: byType.churn.count,
      amount: byType.churn.total,
      positive: false,
    },
    {
      key: "refund",
      label: "Reembolsos",
      icon: AlertOctagon,
      iconClass: "bg-[oklch(0.95_0.03_25)] text-[oklch(0.55_0.18_25)]",
      count: byType.refund.count,
      amount: byType.refund.total,
      positive: false,
    },
  ].filter((r) => r.count > 0);

  return (
    <div className="card-soft p-5">
      <header className="flex items-end justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold">Movimentação de MRR no período</h3>
          <p className="text-xs text-muted-foreground">
            Entradas {brlSigned(positives)} · Saídas {brlSigned(negatives)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground uppercase tracking-wider">
            Net New MRR
          </p>
          <p
            className={`text-2xl font-bold tabular-nums leading-tight ${
              netNewMrr >= 0 ? "text-forest" : "text-destructive"
            }`}
          >
            {brlSigned(netNewMrr)}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          Sem movimentação no período.
        </p>
      ) : (
        <ul className="divide-y divide-border/50">
          {rows.map((r) => {
            const Icon = r.icon;
            return (
              <li key={r.key} className="flex items-center gap-3 py-2.5">
                <div className={`size-9 rounded-xl grid place-items-center shrink-0 ${r.iconClass}`}>
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{r.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.count} {r.count === 1 ? "movimento" : "movimentos"}
                  </p>
                </div>
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    r.positive ? "text-forest" : "text-destructive"
                  }`}
                >
                  {brlSigned(r.amount)}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
