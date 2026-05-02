import type { MetaInsights } from "@shared/types";

const num = (n: number) => n.toLocaleString("pt-BR");

type Step = { label: string; value: number };

/**
 * Funil de conversão visual vertical. A forma afina de cima pra baixo,
 * cada seção tem largura proporcional ao valor (relativo à primeira etapa).
 *
 * Layout: card branco com header dark, gradient nas cores da marca
 * (lime soft no topo → forest no fundo). Labels (nome / valor) ficam
 * FORA do funil pra contraste ideal; só o % grande fica dentro.
 */
export function VerticalFunnel({ insights }: { insights: MetaInsights }) {
  const allSteps: Step[] = [
    { label: "Clicks", value: insights.clicks },
    { label: "Vis. LP", value: insights.landingPageViews },
    { label: "View Content", value: insights.viewContent },
    { label: "Add to Cart", value: insights.addToCart },
    { label: "Initiate Checkout", value: insights.initiateCheckout },
    { label: "Compras", value: insights.purchases },
  ].filter((s) => s.value > 0);

  if (allSteps.length < 2) {
    return (
      <div className="card-soft p-6 flex items-center justify-center h-full text-sm text-muted-foreground text-center">
        Sem dados suficientes pra desenhar o funil.
      </div>
    );
  }

  const steps = allSteps;
  const N = steps.length;

  // Layout do SVG:
  // | LABEL_W |        FUNNEL        | VALUE_W |
  const W = 360;
  const H = 460;
  const LABEL_W = 80;
  const VALUE_W = 60;
  const FUNNEL_X0 = LABEL_W;
  const FUNNEL_X1 = W - VALUE_W;
  const innerW = FUNNEL_X1 - FUNNEL_X0;
  const sectionH = H / N;
  const maxValue = steps[0].value;

  // Largura mínima 6px pra última etapa não sumir quando volume cai 99%
  const widths = steps.map((s) =>
    Math.max(6, (s.value / maxValue) * innerW),
  );

  const yTop = (i: number) => i * sectionH;
  const yBot = (i: number) => (i + 1) * sectionH;
  const funnelCx = (FUNNEL_X0 + FUNNEL_X1) / 2;
  const xLeft = (i: number) => funnelCx - widths[i] / 2;
  const xRight = (i: number) => funnelCx + widths[i] / 2;

  // Path: top-left → desce direita → bottom → sobe esquerda
  let d = `M ${xLeft(0)} ${yTop(0)} L ${xRight(0)} ${yTop(0)}`;

  for (let i = 0; i < N; i++) {
    if (i === N - 1) {
      d += ` L ${xRight(i)} ${yBot(i)}`;
    } else {
      const yMid = yTop(i) + sectionH / 2;
      d += ` C ${xRight(i)} ${yMid}, ${xRight(i + 1)} ${yMid}, ${xRight(i + 1)} ${yBot(i)}`;
    }
  }

  d += ` L ${xLeft(N - 1)} ${yBot(N - 1)}`;
  d += ` L ${xLeft(N - 1)} ${yTop(N - 1)}`;

  for (let i = N - 2; i >= 0; i--) {
    const yMid = yTop(i) + sectionH / 2;
    d += ` C ${xLeft(i + 1)} ${yMid}, ${xLeft(i)} ${yMid}, ${xLeft(i)} ${yTop(i)}`;
  }

  d += " Z";

  return (
    <div className="card-soft overflow-hidden h-full">
      <div className="px-5 py-4 border-b border-border">
        <h3 className="font-semibold text-foreground">Funil visual</h3>
        <p className="text-xs text-muted-foreground">% relativa a clicks</p>
      </div>

      <div className="p-3 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          className="block max-h-[460px]"
        >
          <defs>
            <linearGradient id="vFunnelGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="oklch(0.86 0.18 130)" />
              <stop offset="60%" stopColor="oklch(0.55 0.12 145)" />
              <stop offset="100%" stopColor="oklch(0.24 0.045 155)" />
            </linearGradient>
          </defs>

          {/* Forma do funil */}
          <path d={d} fill="url(#vFunnelGrad)" />

          {/* Divisores horizontais entre seções (só na area do funil) */}
          {steps.slice(1).map((_, i) => (
            <line
              key={i}
              x1={FUNNEL_X0 - 4}
              y1={(i + 1) * sectionH}
              x2={FUNNEL_X1 + 4}
              y2={(i + 1) * sectionH}
              stroke="oklch(0.85 0.02 145)"
              strokeWidth="1"
            />
          ))}

          {/* Labels: nome (esq, fora) · % (centro, dentro) · valor (dir, fora) */}
          {steps.map((step, i) => {
            const cy = i * sectionH + sectionH / 2;
            const pct = (step.value / maxValue) * 100;
            const pctText =
              pct >= 10 ? Math.round(pct).toString() : pct.toFixed(1);
            return (
              <g key={step.label}>
                <text
                  x={FUNNEL_X0 - 8}
                  y={cy + 5}
                  textAnchor="end"
                  className="fill-foreground"
                  fontSize="13"
                  fontWeight="500"
                >
                  {step.label}
                </text>
                <text
                  x={funnelCx}
                  y={cy + 7}
                  textAnchor="middle"
                  fill="white"
                  fontSize="20"
                  fontWeight="700"
                  style={{
                    paintOrder: "stroke",
                    stroke: "oklch(0.24 0.045 155 / 0.4)",
                    strokeWidth: "3px",
                  }}
                >
                  {pctText}%
                </text>
                <text
                  x={FUNNEL_X1 + 8}
                  y={cy + 5}
                  textAnchor="start"
                  className="fill-foreground"
                  fontSize="13"
                  fontWeight="500"
                >
                  {num(step.value)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
