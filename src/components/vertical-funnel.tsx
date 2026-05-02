import type { MetaInsights } from "@shared/types";

const num = (n: number) => n.toLocaleString("pt-BR");

type Step = { label: string; value: number };

/**
 * Funil de conversão visual vertical. A forma afina de cima pra baixo,
 * cada seção tem largura proporcional ao valor (relativo à primeira etapa).
 *
 * Complementa o ConversionFunnel (cards verticais com setas):
 * aqui é a forma desenhada pra dar o "wow" visual da queda de volume.
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

  const W = 360;
  const H = 460;
  const PAD_X = 16;
  const innerW = W - PAD_X * 2;
  const sectionH = H / N;
  const maxValue = steps[0].value;

  // Largura mínima 6px pra última etapa não sumir quando volume cai 99%
  const widths = steps.map((s) =>
    Math.max(6, (s.value / maxValue) * innerW),
  );

  const yTop = (i: number) => i * sectionH;
  const yBot = (i: number) => (i + 1) * sectionH;
  const xLeft = (i: number) => PAD_X + (innerW - widths[i]) / 2;
  const xRight = (i: number) => PAD_X + (innerW + widths[i]) / 2;

  // Path: começa no top-left, desce pela direita, atravessa o bottom,
  // sobe pela esquerda. Bezier dentro de cada seção pra suavizar.
  // Última seção tem largura constante (sem transição) pra não sumir num ponto.
  let d = `M ${xLeft(0)} ${yTop(0)} L ${xRight(0)} ${yTop(0)}`;

  // Lado direito: desce, transitando widths[i] -> widths[i+1] dentro da seção i
  for (let i = 0; i < N; i++) {
    if (i === N - 1) {
      d += ` L ${xRight(i)} ${yBot(i)}`;
    } else {
      const yMid = yTop(i) + sectionH / 2;
      d += ` C ${xRight(i)} ${yMid}, ${xRight(i + 1)} ${yMid}, ${xRight(i + 1)} ${yBot(i)}`;
    }
  }

  // Bottom edge (constante, largura widths[N-1])
  d += ` L ${xLeft(N - 1)} ${yBot(N - 1)}`;

  // Lado esquerdo: sobe espelhando o lado direito.
  // Última seção (i=N-1) primeiro: linha reta subindo (largura constante).
  d += ` L ${xLeft(N - 1)} ${yTop(N - 1)}`;
  // Demais seções: bezier indo da direita pra esquerda (alargando)
  for (let i = N - 2; i >= 0; i--) {
    const yMid = yTop(i) + sectionH / 2;
    d += ` C ${xLeft(i + 1)} ${yMid}, ${xLeft(i)} ${yMid}, ${xLeft(i)} ${yTop(i)}`;
  }

  d += " Z";

  return (
    <div className="card-soft overflow-hidden bg-forest h-full">
      <div className="px-5 py-4 border-b border-white/10">
        <h3 className="font-semibold text-[oklch(0.96_0.04_130)]">
          Funil visual
        </h3>
        <p className="text-xs text-white/60">% relativa a clicks</p>
      </div>

      <div className="p-4 flex items-center justify-center">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="xMidYMid meet"
          width="100%"
          className="block max-h-[460px]"
        >
          <defs>
            <linearGradient id="vFunnelGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="40%" stopColor="#7c3aed" />
              <stop offset="80%" stopColor="#db2777" />
              <stop offset="100%" stopColor="#ef4444" />
            </linearGradient>
          </defs>

          {/* Forma do funil */}
          <path d={d} fill="url(#vFunnelGrad)" />

          {/* Divisores horizontais entre seções */}
          {steps.slice(1).map((_, i) => (
            <line
              key={i}
              x1={PAD_X - 4}
              y1={(i + 1) * sectionH}
              x2={W - PAD_X + 4}
              y2={(i + 1) * sectionH}
              stroke="white"
              strokeOpacity="0.15"
              strokeWidth="1"
            />
          ))}

          {/* Labels: nome (esq) · % (centro) · valor (dir) */}
          {steps.map((step, i) => {
            const cy = i * sectionH + sectionH / 2;
            const pct = (step.value / maxValue) * 100;
            const pctText =
              pct >= 10 ? Math.round(pct).toString() : pct.toFixed(1);
            return (
              <g key={step.label}>
                <text
                  x={PAD_X + 4}
                  y={cy + 5}
                  textAnchor="start"
                  fill="white"
                  fillOpacity="0.85"
                  fontSize="13"
                  fontWeight="500"
                >
                  {step.label}
                </text>
                <text
                  x={W / 2}
                  y={cy + 7}
                  textAnchor="middle"
                  fill="white"
                  fontSize="20"
                  fontWeight="700"
                >
                  {pctText}%
                </text>
                <text
                  x={W - PAD_X - 4}
                  y={cy + 5}
                  textAnchor="end"
                  fill="white"
                  fillOpacity="0.85"
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
