import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  XCircle,
  QrCode,
  AlertCircle,
  RefreshCw,
  ShoppingCart,
  Banknote,
  RotateCcw,
  MessageSquare,
  MessageSquareOff,
  Activity,
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

export function LiveActivityFeed() {
  const { produtoId } = useProdutoContext();
  const produtoParam = produtoId ?? "all";

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["activity", "recent", produtoParam],
    queryFn: () => api.get<ActivityItem[]>(`/api/activity/recent?produtoId=${produtoParam}&limit=30`),
    refetchInterval: 5000, // poll a cada 5s
    refetchIntervalInBackground: false,
  });

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
              {isFetching ? "Atualizando..." : "Atualiza a cada 5s"}
            </p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          Sem atividade recente. Webhooks vão aparecer aqui em tempo real.
        </p>
      ) : (
        <ul className="space-y-2 max-h-[600px] overflow-y-auto">
          {data.map((item) => (
            <ActivityRow key={`${item.tipo}-${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const meta = EVENT_META[item.eventType] ?? EVENT_META.default;
  const Icon = meta.icon;
  const lead = item.leadNome ?? "Sem lead";
  const valor = item.meta?.valor ? brl(item.meta.valor) : null;
  const time = timeFmt.format(new Date(item.receivedAt));

  return (
    <li className="flex items-start gap-3 p-3 rounded-2xl hover:bg-muted/30 transition-colors group">
      <div className={`size-9 rounded-2xl grid place-items-center shrink-0 ${meta.tone}`}>
        <Icon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{lead}</span>
          <span className="text-xs text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">{meta.label}</span>
          {valor ? (
            <span className="text-xs font-semibold tabular-nums px-2 py-0.5 rounded-md bg-secondary">
              {valor}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
          {item.produtoNome ? (
            <>
              <span className="truncate">{item.produtoNome}</span>
              <span>·</span>
            </>
          ) : null}
          {item.meta?.template ? (
            <>
              <span className="truncate font-mono">{item.meta.template}</span>
              <span>·</span>
            </>
          ) : null}
          <span className="tabular-nums shrink-0">{time}</span>
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
