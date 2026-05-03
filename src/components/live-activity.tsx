import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  QrCode,
  AlertCircle,
  RefreshCw,
  ShoppingCart,
  RotateCcw,
  MessageSquare,
  MessageSquareOff,
  Activity,
  ChevronDown,
} from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import type { ActivityItem } from "@shared/types";

const EVENT_META: Record<
  string,
  { label: string; icon: typeof CheckCircle2; tone: string }
> = {
  compra_aprovada: {
    label: "Compra aprovada",
    icon: CheckCircle2,
    tone: "bg-[oklch(0.94_0.07_130)] text-forest",
  },
  assinatura_renovada: {
    label: "Assinatura renovada",
    icon: RefreshCw,
    tone: "bg-[oklch(0.94_0.07_130)] text-forest",
  },
  pix_gerado: {
    label: "PIX gerado",
    icon: QrCode,
    tone: "bg-lime-soft text-forest",
  },
  pix_expirado: {
    label: "PIX expirado",
    icon: XCircle,
    tone: "bg-[oklch(0.95_0.04_25)] text-[oklch(0.55_0.18_25)]",
  },
  carrinho_abandonado: {
    label: "Carrinho abandonado",
    icon: ShoppingCart,
    tone: "bg-[oklch(0.95_0.05_85)] text-[oklch(0.45_0.18_75)]",
  },
  reembolso: {
    label: "Reembolso",
    icon: RotateCcw,
    tone: "bg-[oklch(0.95_0.04_25)] text-[oklch(0.55_0.18_25)]",
  },
  assinatura_cancelada: {
    label: "Assinatura cancelada",
    icon: XCircle,
    tone: "bg-[oklch(0.95_0.04_25)] text-[oklch(0.55_0.18_25)]",
  },
  assinatura_atrasada: {
    label: "Assinatura atrasada",
    icon: AlertCircle,
    tone: "bg-[oklch(0.95_0.05_85)] text-[oklch(0.45_0.18_75)]",
  },
  compra_recusada: {
    label: "Compra recusada",
    icon: XCircle,
    tone: "bg-[oklch(0.95_0.04_25)] text-[oklch(0.55_0.18_25)]",
  },
  msg_sent: {
    label: "Mensagem enviada",
    icon: MessageSquare,
    tone: "bg-secondary text-foreground",
  },
  msg_skipped: {
    label: "Mensagem cancelada",
    icon: MessageSquareOff,
    tone: "bg-muted text-muted-foreground",
  },
  msg_failed: {
    label: "Falha ao enviar",
    icon: XCircle,
    tone: "bg-[oklch(0.95_0.04_25)] text-[oklch(0.55_0.18_25)]",
  },
  default: {
    label: "Evento",
    icon: Activity,
    tone: "bg-muted text-muted-foreground",
  },
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const PAYMENT_LABELS: Record<string, string> = {
  credit_card: "Cartão",
  cartao: "Cartão",
  pix: "PIX",
  boleto: "Boleto",
  bolepix: "Bolepix",
  paypal: "PayPal",
};

function formatPayment(method: string | null | undefined): string | null {
  if (!method) return null;
  const key = method.toLowerCase().trim();
  return PAYMENT_LABELS[key] ?? method;
}

const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "agora";
  if (diff < 3600) return `${Math.floor(diff / 60)}min atrás`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h atrás`;
  return `${Math.floor(diff / 86400)}d atrás`;
}

type Group = {
  key: string;
  leadId: number | null;
  leadNome: string;
  items: ActivityItem[];
  latestAt: number;
};

/** Agrupa eventos por lead. Eventos sem lead viram grupo individual. */
function groupByLead(items: ActivityItem[]): Group[] {
  const map = new Map<string, Group>();
  for (const item of items) {
    const key =
      item.leadId != null
        ? `lead-${item.leadId}`
        : `solo-${item.tipo}-${item.id}`;
    const existing = map.get(key);
    const ts = new Date(item.receivedAt).getTime();
    if (existing) {
      existing.items.push(item);
      if (ts > existing.latestAt) existing.latestAt = ts;
    } else {
      map.set(key, {
        key,
        leadId: item.leadId,
        leadNome: item.leadNome ?? "Sem lead",
        items: [item],
        latestAt: ts,
      });
    }
  }
  for (const g of map.values()) {
    g.items.sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    );
  }
  return Array.from(map.values()).sort((a, b) => b.latestAt - a.latestAt);
}

export function LiveActivityFeed() {
  const { produtoId } = useProdutoContext();
  const produtoParam = produtoId ?? "all";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["activity", "recent", produtoParam],
    queryFn: () => api.get<ActivityItem[]>(`/api/activity/recent?produtoId=${produtoParam}&limit=50`),
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });

  const groups = useMemo(() => (data ? groupByLead(data) : []), [data]);

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="card-soft p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-2xl bg-lime-soft text-forest grid place-items-center">
            <Activity className="size-4" />
          </div>
          <div>
            <h3 className="font-semibold text-base">Atividade ao vivo</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span
                className={`size-1.5 rounded-full ${isFetching ? "bg-forest animate-pulse" : "bg-muted-foreground/40"}`}
              />
              {isFetching ? "Atualizando..." : "Atualiza a cada 5s · agrupado por lead"}
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Sem atividade recente. Webhooks vão aparecer aqui em tempo real.
        </p>
      ) : (
        <ul className="space-y-2 max-h-[600px] overflow-y-auto">
          {groups.map((g) => (
            <LeadGroupRow
              key={g.key}
              group={g}
              isExpanded={expanded.has(g.key)}
              onToggle={() => toggle(g.key)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function LeadGroupRow({
  group,
  isExpanded,
  onToggle,
}: {
  group: Group;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const latest = group.items[0];
  const meta = EVENT_META[latest.eventType] ?? EVENT_META.default;
  const Icon = meta.icon;
  const valor = latest.meta?.valor ? brl(latest.meta.valor) : null;
  const payment = formatPayment(latest.meta?.paymentMethod);
  const count = group.items.length;

  return (
    <li className="rounded-2xl border border-border/40 overflow-hidden bg-background/40">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-3 hover:bg-muted/30 transition-colors text-left"
      >
        <div className={`size-9 rounded-2xl grid place-items-center shrink-0 ${meta.tone}`}>
          <Icon className="size-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{group.leadNome}</span>
            {count > 1 ? (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-lime-soft text-forest">
                {count} eventos
              </span>
            ) : null}
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-sm text-muted-foreground">{meta.label}</span>
            {valor ? (
              <span className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md bg-secondary">
                {valor}
              </span>
            ) : null}
            {payment ? (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-foreground/70">
                {payment}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
            {latest.produtoNome ? (
              <>
                <span className="truncate">{latest.produtoNome}</span>
                <span>·</span>
              </>
            ) : null}
            <span className="tabular-nums shrink-0">
              {timeFmt.format(new Date(latest.receivedAt))}
            </span>
            <span>·</span>
            <span className="shrink-0">{relativeTime(latest.receivedAt)}</span>
          </div>
        </div>
        {count > 1 ? (
          <ChevronDown
            className={`size-4 text-muted-foreground shrink-0 mt-2 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          />
        ) : null}
      </button>

      {isExpanded && count > 1 ? (
        <ul className="border-t border-border/40 bg-muted/20">
          {group.items.map((item) => (
            <NestedRow key={`${item.tipo}-${item.id}`} item={item} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function NestedRow({ item }: { item: ActivityItem }) {
  const meta = EVENT_META[item.eventType] ?? EVENT_META.default;
  const Icon = meta.icon;
  const valor = item.meta?.valor ? brl(item.meta.valor) : null;
  const payment = formatPayment(item.meta?.paymentMethod);

  return (
    <li className="flex items-start gap-3 px-3 py-2 pl-12 hover:bg-muted/30 transition-colors border-t border-border/30 first:border-t-0">
      <div className={`size-7 rounded-xl grid place-items-center shrink-0 ${meta.tone}`}>
        <Icon className="size-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm">{meta.label}</span>
          {valor ? (
            <span className="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded-md bg-secondary">
              {valor}
            </span>
          ) : null}
          {payment ? (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-muted text-foreground/70">
              {payment}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          {item.meta?.template ? (
            <>
              <span className="truncate font-mono">{item.meta.template}</span>
              <span>·</span>
            </>
          ) : null}
          <span className="tabular-nums shrink-0">
            {timeFmt.format(new Date(item.receivedAt))}
          </span>
          <span>·</span>
          <span className="shrink-0">{relativeTime(item.receivedAt)}</span>
        </div>
        {item.meta?.erro ? (
          <p className="text-xs text-muted-foreground/80 mt-0.5 italic truncate">
            {item.meta.erro}
          </p>
        ) : null}
      </div>
    </li>
  );
}
