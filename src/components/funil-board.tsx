import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { LayoutGrid, MessageSquare } from "lucide-react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { periodToRange } from "@/lib/period";
import { STATUS_LABEL } from "@shared/labels";
import type { FunilSnapshotColumn } from "@shared/types";

const STATUS_TONE: Record<string, string> = {
  lead_novo: "bg-[oklch(0.96_0.02_250)]",
  carrinho_abandonado: "bg-[oklch(0.95_0.05_85)]",
  pix_gerado: "bg-lime-soft",
  pix_expirado: "bg-[oklch(0.95_0.04_25)]",
  cliente_ativo: "bg-[oklch(0.94_0.07_130)]",
  cliente_em_risco: "bg-[oklch(0.95_0.05_85)]",
  cliente_cancelado: "bg-[oklch(0.95_0.04_25)]",
};

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

function timeAgo(horas: number): string {
  if (horas === 0) return "agora";
  if (horas < 24) return `${horas}h`;
  return `${Math.floor(horas / 24)}d`;
}

export function FunilBoard({ onLeadClick }: { onLeadClick?: (id: number) => void }) {
  const { produtoId, period, customDate } = useProdutoContext();
  const produtoParam = produtoId ?? "all";
  const { since, until } = useMemo(
    () => periodToRange(period, customDate),
    [period, customDate],
  );
  const sinceParam = since ? since.toISOString() : "";
  const untilParam = until.toISOString();

  // Kanban filtra leads por DATA DE CRIAÇÃO no período. "Tudo" = todos os
  // ativos, "Hoje" = só leads que entraram hoje, etc.
  const { data, isLoading } = useQuery({
    queryKey: ["activity", "funil", produtoParam, sinceParam, untilParam],
    queryFn: () =>
      api.get<FunilSnapshotColumn[]>(
        `/api/activity/funil?produtoId=${produtoParam}&since=${sinceParam}&until=${untilParam}`,
      ),
    refetchInterval: 8000, // poll a cada 8s
  });

  return (
    <div className="card-soft p-5">
      <div className="flex items-center gap-2 mb-4">
        <div className="size-9 rounded-2xl bg-lime-soft text-forest grid place-items-center">
          <LayoutGrid className="size-4" />
        </div>
        <div>
          <h3 className="font-semibold text-base">Funil ao vivo</h3>
          <p className="text-xs text-muted-foreground">
            Leads se movem entre colunas conforme webhooks chegam
          </p>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">Sem leads ainda.</p>
      ) : (
        <div className="overflow-x-auto -mx-5 px-5 pb-2">
          <div className="flex gap-3 min-w-max">
            {data.map((col) => (
              <FunilColumn key={col.status} column={col} onLeadClick={onLeadClick} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FunilColumn({
  column,
  onLeadClick,
}: {
  column: FunilSnapshotColumn;
  onLeadClick?: (id: number) => void;
}) {
  const tone = STATUS_TONE[column.status] ?? "bg-muted/40";
  const label = STATUS_LABEL[column.status as keyof typeof STATUS_LABEL] ?? column.status;

  return (
    <div className="w-[260px] shrink-0">
      <div className={`rounded-2xl ${tone} px-3 py-2 mb-2 flex items-center justify-between`}>
        <span className="text-xs font-semibold uppercase tracking-wider text-foreground/80">
          {label}
        </span>
        <span className="text-sm font-bold tabular-nums bg-card/80 rounded-lg px-2 py-0.5">
          {column.count}
        </span>
      </div>

      <div className="space-y-2">
        {column.leads.map((l) => (
          <div
            key={l.id}
            onClick={() => onLeadClick?.(l.id)}
            className="bg-card border border-border rounded-2xl p-3 hover:border-foreground/20 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="size-7 rounded-lg bg-lime-soft grid place-items-center text-forest font-semibold text-[10px] shrink-0">
                {l.nome.slice(0, 2).toUpperCase()}
              </div>
              <p className="font-medium text-sm truncate flex-1">{l.nome}</p>
              {l.mensagensEnviadas > 0 ? (
                <span
                  title={`${l.mensagensEnviadas} ${l.mensagensEnviadas === 1 ? "mensagem enviada" : "mensagens enviadas"}`}
                  className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-secondary text-[10px] font-bold tabular-nums text-forest shrink-0"
                >
                  <MessageSquare className="size-2.5" />
                  {String(l.mensagensEnviadas).padStart(2, "0")}
                </span>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground pl-9">
              {l.valorAssinatura ? (
                <span className="font-semibold tabular-nums">{brl(l.valorAssinatura)}</span>
              ) : (
                <span>—</span>
              )}
              <span className="tabular-nums">{timeAgo(l.horasNoEstagio)}</span>
            </div>
          </div>
        ))}
        {column.leads.length === 0 ? (
          <div className="border-2 border-dashed border-border rounded-2xl p-4 text-center">
            <p className="text-xs text-muted-foreground">Vazio</p>
          </div>
        ) : null}
        {column.count > column.leads.length ? (
          <p className="text-xs text-muted-foreground text-center pt-1">
            +{column.count - column.leads.length} mais
          </p>
        ) : null}
      </div>
    </div>
  );
}
