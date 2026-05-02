import { Eye, Users, MousePointerClick, Globe, ShoppingBag, ShoppingCart, CheckCircle2 } from "lucide-react";
import type { MetaInsights } from "@shared/types";

const num = (n: number) => n.toLocaleString("pt-BR");
const pct = (n: number) => `${n.toFixed(1)}%`;

type Step = {
  icon: typeof Eye;
  label: string;
  value: number;
  hint?: string;
};

/**
 * Funil visual de conversão Meta Ads. Cada step mostra a contagem absoluta,
 * e as setas entre steps mostram a taxa de conversão dessa transição.
 *
 * Steps com valor 0 são ocultados pra não poluir (ex: campanha sem
 * landing_page_view configurado, ou sem add_to_cart event).
 */
export function ConversionFunnel({ insights }: { insights: MetaInsights }) {
  const steps: Step[] = [
    {
      icon: Eye,
      label: "Impressões",
      value: insights.impressions,
      hint: `Frequência ${insights.frequency.toFixed(1)}`,
    },
    {
      icon: Users,
      label: "Reach (únicos)",
      value: insights.reach,
    },
    {
      icon: MousePointerClick,
      label: "Clicks no link",
      value: insights.clicks,
      hint: `CTR ${pct(insights.ctr)}`,
    },
    {
      icon: Globe,
      label: "Visualizações da LP",
      value: insights.landingPageViews,
    },
    {
      icon: ShoppingBag,
      label: "View Content",
      value: insights.viewContent,
    },
    {
      icon: ShoppingCart,
      label: "Initiate Checkout",
      value: insights.initiateCheckout,
    },
    {
      icon: CheckCircle2,
      label: "Compras (Pixel)",
      value: insights.purchases,
      hint: `R$ ${num(Math.round(insights.purchaseValue))} receita`,
    },
  ].filter((s) => s.value > 0);

  return (
    <div className="card-soft p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="font-semibold">Funil de conversão</h3>
          <p className="text-xs text-muted-foreground">
            Cada etapa do tráfego pago. Taxa entre etapas indica onde o usuário desiste.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {steps.map((step, idx) => {
          const next = steps[idx + 1];
          const conversionRate = next && step.value > 0
            ? (next.value / step.value) * 100
            : null;
          const isWeak =
            conversionRate !== null && conversionRate < weakThreshold(step.label, next?.label);

          const Icon = step.icon;
          return (
            <div key={step.label}>
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-muted/30">
                <div className="size-9 rounded-2xl bg-lime-soft text-forest grid place-items-center shrink-0">
                  <Icon className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{step.label}</div>
                  {step.hint ? (
                    <div className="text-xs text-muted-foreground">{step.hint}</div>
                  ) : null}
                </div>
                <div className="text-2xl font-bold tabular-nums">{num(step.value)}</div>
              </div>

              {next && conversionRate !== null ? (
                <div className="flex items-center gap-2 ml-7 my-1">
                  <div className="w-px h-4 bg-border" />
                  <span
                    className={
                      isWeak
                        ? "text-xs font-semibold text-destructive tabular-nums"
                        : "text-xs font-semibold text-forest tabular-nums"
                    }
                  >
                    ↓ {pct(conversionRate)} convertem
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({step.label.toLowerCase()} → {next.label.toLowerCase()})
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Heurística simples de "taxa baixa" pra destacar em vermelho onde tá perdendo
 * mais que o esperado. Valores conservadores baseados em benchmarks SaaS.
 */
function weakThreshold(from: string, to: string | undefined): number {
  if (!to) return 0;
  const key = `${from}→${to}`.toLowerCase();
  // CTR (impressões → reach é só dedup, sempre alto)
  if (key.includes("clicks") && key.includes("visualizações da lp")) return 70; // alto bounce
  if (key.includes("visualizações da lp") && key.includes("view content")) return 30;
  if (key.includes("view content") && key.includes("initiate checkout")) return 10;
  if (key.includes("initiate checkout") && key.includes("compras")) return 10;
  return 5;
}
