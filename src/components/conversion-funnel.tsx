import type { MetaInsights } from "@shared/types";

const num = (n: number) => n.toLocaleString("pt-BR");

type Step = { label: string; value: number };

/**
 * Funil de conversão visual em SVG. Mostra a queda de volume entre cada
 * etapa do tráfego pago como uma forma que afina da esquerda pra direita.
 *
 * - Largura de cada etapa proporcional ao valor (relativo à primeira)
 * - Transições suaves (bezier) entre seções
 * - % no centro = conversão acumulada vs primeira etapa
 * - Etapas com valor 0 são escondidas (campanhas sem todos os events configurados)
 */
export function ConversionFunnel({ insights }: { insights: MetaInsights }) {
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
      <div className="card-soft p-8 text-center text-sm text-muted-foreground">
        Sem dados suficientes pra montar o funil. Configure mais eventos no Pixel.
      </div>
    );
  }

  const steps = allSteps;
  const N = steps.length;

  // Dimensões do viewBox
  const W = 1200;
  const H = 380;
  const PAD_TOP = 40;
  const PAD_BOTTOM = 40;
  const innerH = H - PAD_TOP - PAD_BOTTOM;

  const sectionW = W / N;
  const maxValue = steps[0].value;

  // Altura do funil em cada etapa (proporcional ao valor)
  // Mínimo 4px pra última etapa não sumir
  const heights = steps.map((s) =>
    Math.max(4, (s.value / maxValue) * innerH),
  );

  const xLeft = (i: number) => i * sectionW;
  const xRight = (i: number) => (i + 1) * sectionW;
  const yTop = (i: number) => PAD_TOP + (innerH - heights[i]) / 2;
  const yBot = (i: number) => PAD_TOP + (innerH + heights[i]) / 2;

  // Construir path do funil (forma fechada com bezier entre seções)
  let d = `M ${xLeft(0)} ${yTop(0)}`;

  // Borda superior, esquerda → direita
  for (let i = 0; i < N; i++) {
    if (i === N - 1) {
      d += ` L ${xRight(i)} ${yTop(i)}`;
    } else {
      const xMid = xLeft(i) + sectionW / 2;
      d += ` C ${xMid} ${yTop(i)}, ${xMid} ${yTop(i + 1)}, ${xRight(i)} ${yTop(i + 1)}`;
    }
  }

  // Borda direita
  d += ` L ${xRight(N - 1)} ${yBot(N - 1)}`;

  // Borda inferior, direita → esquerda
  for (let i = N - 1; i >= 0; i--) {
    if (i === N - 1) {
      d += ` L ${xLeft(i)} ${yBot(i)}`;
    } else {
      const xMid = xLeft(i) + sectionW / 2;
      d += ` C ${xMid} ${yBot(i + 1)}, ${xMid} ${yBot(i)}, ${xLeft(i)} ${yBot(i)}`;
    }
  }

  d += " Z";

  return (
    <div className="card-soft overflow-hidden bg-forest">
      <div className="px-6 py-4 flex items-center justify-between border-b border-white/10">
        <div>
          <h3 className="font-semibold text-[oklch(0.96_0.04_130)]">
            Funil de Conversão
          </h3>
          <p className="text-xs text-white/60">
            Cada etapa do tráfego pago Meta · % relativo a clicks
          </p>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        className="block"
      >
        <defs>
          <linearGradient id="funnelGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="40%" stopColor="#7c3aed" />
            <stop offset="80%" stopColor="#db2777" />
            <stop offset="100%" stopColor="#ef4444" />
          </linearGradient>
        </defs>

        {/* Forma do funil */}
        <path d={d} fill="url(#funnelGrad)" />

        {/* Divisores verticais entre seções */}
        {steps.slice(1).map((_, i) => (
          <line
            key={i}
            x1={(i + 1) * sectionW}
            y1={PAD_TOP - 12}
            x2={(i + 1) * sectionW}
            y2={H - PAD_BOTTOM + 12}
            stroke="white"
            strokeOpacity="0.15"
            strokeWidth="1"
          />
        ))}

        {/* Labels: nome (topo) · % (centro) · valor (base) */}
        {steps.map((step, i) => {
          const cx = i * sectionW + sectionW / 2;
          const pct = (step.value / maxValue) * 100;
          const pctText =
            pct >= 10 ? Math.round(pct).toString() : pct.toFixed(1);
          return (
            <g key={step.label}>
              <text
                x={cx}
                y={24}
                textAnchor="middle"
                fill="white"
                fillOpacity="0.75"
                fontSize="15"
                fontWeight="500"
              >
                {step.label}
              </text>
              <text
                x={cx}
                y={H / 2 + 12}
                textAnchor="middle"
                fill="white"
                fontSize="36"
                fontWeight="700"
              >
                {pctText}%
              </text>
              <text
                x={cx}
                y={H - 16}
                textAnchor="middle"
                fill="white"
                fillOpacity="0.75"
                fontSize="15"
                fontWeight="500"
              >
                {num(step.value)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
