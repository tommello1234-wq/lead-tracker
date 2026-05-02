import { CreditCard, QrCode, Receipt, HelpCircle, TrendingUp, Clock, Users } from "lucide-react";
import type {
  SaasMetricsResponse,
  PaymentMethod,
  MetodoBreakdown,
  RetencaoPorMetodo,
  FunilPix,
} from "@shared/types";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const pct = (n: number, digits = 1) =>
  `${(n * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;

const METODO_META: Record<
  PaymentMethod,
  { label: string; icon: typeof CreditCard; tone: string }
> = {
  cartao: {
    label: "Cartão",
    icon: CreditCard,
    tone: "bg-forest text-[oklch(0.86_0.18_130)]",
  },
  pix: {
    label: "PIX",
    icon: QrCode,
    tone: "bg-lime-soft text-forest",
  },
  boleto: {
    label: "Boleto",
    icon: Receipt,
    tone: "bg-[oklch(0.95_0.05_85)] text-[oklch(0.45_0.18_75)]",
  },
  indefinido: {
    label: "Indefinido",
    icon: HelpCircle,
    tone: "bg-muted text-muted-foreground",
  },
};

export function SaasDashboard({ data }: { data: SaasMetricsResponse }) {
  // Ordena: cartão > pix > boleto > indefinido
  const order: PaymentMethod[] = ["cartao", "pix", "boleto", "indefinido"];
  const metodosOrdered = [...data.metodos].sort(
    (a, b) => order.indexOf(a.metodo) - order.indexOf(b.metodo),
  );
  const retencaoMap = new Map(data.retencao.map((r) => [r.metodo, r]));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold tracking-tight">Métricas SaaS</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Recorrência, conversão e retenção segregadas por método de pagamento
        </p>
      </div>

      {/* Comparison cards por método */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {metodosOrdered
          .filter((m) => m.metodo !== "indefinido" || m.totalCompras > 0)
          .map((m) => (
            <MetodoCard
              key={m.metodo}
              breakdown={m}
              retencao={retencaoMap.get(m.metodo)}
            />
          ))}
      </div>

      {/* Funil PIX */}
      <PixFunnelCard funil={data.funilPix} />
    </div>
  );
}

/* ============================================================ */
function MetodoCard({
  breakdown,
  retencao,
}: {
  breakdown: MetodoBreakdown;
  retencao: RetencaoPorMetodo | undefined;
}) {
  const meta = METODO_META[breakdown.metodo];
  const Icon = meta.icon;

  return (
    <div className="card-soft p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className={`size-11 rounded-2xl grid place-items-center ${meta.tone}`}>
          <Icon className="size-5" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">{meta.label}</h3>
          <p className="text-xs text-muted-foreground">
            {breakdown.totalCompras.toLocaleString("pt-BR")} transações
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="MRR" value={brl(breakdown.mrr)} />
        <Stat label="Ativos" value={breakdown.ativos.toLocaleString("pt-BR")} />
        <Stat label="ARPU" value={brl(breakdown.arpu)} />
        <Stat label="Receita total" value={brl(breakdown.receitaTotal)} />
      </div>

      {retencao ? (
        <div className="pt-4 border-t border-border space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            <span>Retenção</span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <RetentionStat
              label="Tempo médio"
              value={`${retencao.diasMediosAtivo}d`}
              hint={diasLabel(retencao.diasMediosAtivo)}
            />
            <RetentionStat
              label="30d"
              value={pct(retencao.taxaRetencao30d, 0)}
            />
            <RetentionStat
              label="90d"
              value={pct(retencao.taxaRetencao90d, 0)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums tracking-tight mt-0.5">{value}</p>
    </div>
  );
}

function RetentionStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="bg-muted/30 rounded-xl p-2">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm font-bold tabular-nums">{value}</p>
      {hint ? <p className="text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function diasLabel(dias: number): string {
  if (dias < 30) return "ativo";
  if (dias < 90) return `~${Math.round(dias / 30)} meses`;
  if (dias < 365) return `${Math.round(dias / 30)} meses`;
  return `${(dias / 365).toFixed(1)} anos`;
}

/* ============================================================ */
function PixFunnelCard({ funil }: { funil: FunilPix }) {
  const total = funil.gerados;
  const pctPagos = total > 0 ? funil.pagos / total : 0;
  const pctExpirados = total > 0 ? funil.expirados / total : 0;
  const recoveryRate = funil.expirados > 0 ? funil.recovered / funil.expirados : 0;

  return (
    <div className="card-soft p-6 space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <QrCode className="size-4" />
            Funil PIX
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Conversão e recovery dos PIX gerados no período
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">
            Conversão geral
          </p>
          <p className="text-3xl font-bold tabular-nums" style={{ color: "oklch(0.55 0.18 140)" }}>
            {pct(funil.taxaConversao, 1)}
          </p>
        </div>
      </div>

      {/* Visual funnel */}
      <div className="space-y-2">
        <FunnelBar
          label="PIX gerados"
          value={funil.gerados}
          fillPct={1}
          fillColor="oklch(0.86 0.18 130)"
        />
        <FunnelBar
          label="Pagos"
          value={funil.pagos}
          fillPct={pctPagos}
          fillColor="oklch(0.55 0.18 140)"
          hint={pct(pctPagos, 1)}
        />
        <FunnelBar
          label="Expirados"
          value={funil.expirados}
          fillPct={pctExpirados}
          fillColor="oklch(0.65 0.2 25)"
          hint={pct(pctExpirados, 1)}
        />
        <FunnelBar
          label="Recovered (expirou e voltou)"
          value={funil.recovered}
          fillPct={total > 0 ? funil.recovered / total : 0}
          fillColor="oklch(0.7 0.18 135)"
          hint={`${pct(recoveryRate, 0)} dos expirados`}
        />
      </div>
    </div>
  );
}

function FunnelBar({
  label,
  value,
  fillPct,
  fillColor,
  hint,
}: {
  label: string;
  value: number;
  fillPct: number;
  fillColor: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm mb-1">
        <span className="font-medium">{label}</span>
        <span className="flex items-center gap-2">
          {hint ? (
            <span className="text-xs text-muted-foreground">{hint}</span>
          ) : null}
          <span className="font-bold tabular-nums">
            {value.toLocaleString("pt-BR")}
          </span>
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-muted/50 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${Math.max(fillPct * 100, value > 0 ? 4 : 0)}%`,
            backgroundColor: fillColor,
          }}
        />
      </div>
    </div>
  );
}
