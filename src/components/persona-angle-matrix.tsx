import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ImageIcon,
  TrendingUp,
  ExternalLink,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Angulo, AnguloStatus, Persona } from "@shared/types";

const STATUS_DOT: Record<AnguloStatus, string> = {
  ideia: "#71717a", // zinc
  producao: "#f59e0b", // amber
  rodando: "#10b981", // emerald
  vencedor: "#eab308", // yellow
  perdedor: "#ef4444", // red
  pausado: "#3b82f6", // blue
};

const STATUS_EMOJI: Record<AnguloStatus, string> = {
  ideia: "💡",
  producao: "🟡",
  rodando: "🟢",
  vencedor: "🏆",
  perdedor: "❌",
  pausado: "⏸️",
};

const STATUS_LABEL: Record<AnguloStatus, string> = {
  ideia: "Ideia",
  producao: "Produção",
  rodando: "Rodando",
  vencedor: "Vencedor",
  perdedor: "Perdedor",
  pausado: "Pausado",
};

/**
 * Matriz Persona × Ângulo — cruza todas as personas com todos os nomes
 * únicos de ângulos pra mostrar lacunas (combinações sem teste) e
 * vencedores (combinações com ROAS alto).
 */
export function PersonaAngleMatrix({
  personas,
  produtoId,
  onSelectAngulo,
  onCreateAngulo,
}: {
  personas: Persona[];
  produtoId: number | null;
  onSelectAngulo: (a: Angulo) => void;
  onCreateAngulo: (
    persona: Persona,
    nomeSugerido?: string,
  ) => void;
}) {
  const { data: angulos = [] } = useQuery({
    queryKey: ["angulos", produtoId],
    queryFn: () =>
      api.get<Angulo[]>(
        `/api/angulos${produtoId ? `?produtoId=${produtoId}` : ""}`,
      ),
    enabled: produtoId != null,
  });

  // Extrai colunas (nomes únicos de ângulos, case-insensitive)
  const colunas = useMemo(() => {
    const set = new Map<string, string>(); // key=lowercase, value=display
    for (const a of angulos) {
      const key = a.nome.trim().toLowerCase();
      if (!set.has(key)) set.set(key, a.nome.trim());
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [angulos]);

  // Index: angulos por persona × nome (lowercase)
  const cellByPair = useMemo(() => {
    const m = new Map<string, Angulo>();
    for (const a of angulos) {
      if (a.personaId == null) continue;
      const key = `${a.personaId}::${a.nome.trim().toLowerCase()}`;
      m.set(key, a);
    }
    return m;
  }, [angulos]);

  // Stats agregadas
  const stats = useMemo(() => {
    const total = angulos.length;
    const totalSpend = angulos.reduce(
      (acc, a) =>
        acc + (a.budgetMensal ?? 0) * (a.diasRodando ? a.diasRodando / 30 : 1),
      0,
    );
    const rodando = angulos.filter((a) => a.status === "rodando").length;
    const vencedores = angulos.filter((a) => a.status === "vencedor").length;
    const possibilidades = personas.length * colunas.length;
    const lacunas =
      possibilidades > 0
        ? Math.max(0, possibilidades - cellByPair.size)
        : 0;
    return { total, rodando, vencedores, lacunas, totalSpend };
  }, [angulos, personas, colunas, cellByPair]);

  if (personas.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-card/40 p-12 text-center text-sm text-foreground/60">
        Crie personas primeiro pra ver a matriz.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Stats top */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Ângulos cadastrados" value={String(stats.total)} />
        <StatTile
          label="🟢 Rodando"
          value={String(stats.rodando)}
          tone="emerald"
        />
        <StatTile
          label="🏆 Vencedores"
          value={String(stats.vencedores)}
          tone="yellow"
        />
        <StatTile
          label="🔴 Lacunas"
          value={String(stats.lacunas)}
          hint={`Possíveis: ${personas.length * colunas.length}`}
          tone="red"
        />
      </div>

      {/* Matriz */}
      {colunas.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-12 text-center">
          <div className="text-sm text-foreground/60 mb-3">
            Nenhum ângulo cadastrado ainda.
          </div>
          <div className="text-xs text-foreground/50">
            Vá pra view "Board" e crie ou importe ângulos. A matriz vai se
            preencher automaticamente.
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs border-collapse">
              <thead>
                <tr className="bg-muted/50">
                  <th className="sticky left-0 bg-muted/50 z-10 text-left px-3 py-3 font-semibold text-foreground/70 text-[11px] uppercase tracking-wider w-[200px] min-w-[200px] border-r border-border">
                    Persona / Ângulo
                  </th>
                  {colunas.map((col) => (
                    <th
                      key={col}
                      className="text-left px-3 py-3 font-semibold text-foreground/70 text-[11px] uppercase tracking-wider min-w-[180px] border-r border-border last:border-r-0"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {personas.map((p) => {
                  const cor = p.cor ?? "#71717a";
                  return (
                    <tr key={p.id} className="border-t border-border">
                      {/* Cabeçalho da linha — sticky */}
                      <td
                        className="sticky left-0 bg-card z-10 px-3 py-3 align-top border-r border-border"
                        style={{ background: `${cor}08` }}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className="size-2.5 rounded-full shrink-0 mt-1"
                            style={{ background: cor }}
                          />
                          <div className="min-w-0">
                            <div className="font-bold text-sm text-foreground truncate">
                              {p.nome}
                            </div>
                            <div className="text-[10px] text-foreground/60 mt-0.5">
                              {p.prioridade.toUpperCase()}
                              {p.pctPublicoAtual != null
                                ? ` · ${Math.round(p.pctPublicoAtual)}%`
                                : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      {/* Células */}
                      {colunas.map((col) => {
                        const key = `${p.id}::${col.toLowerCase()}`;
                        const angulo = cellByPair.get(key);
                        return (
                          <td
                            key={col}
                            className="px-2 py-2 align-top border-r border-border last:border-r-0"
                          >
                            {angulo ? (
                              <CellPreenchida
                                angulo={angulo}
                                personaCor={cor}
                                onClick={() => onSelectAngulo(angulo)}
                              />
                            ) : (
                              <CellVazia
                                onClick={() => onCreateAngulo(p, col)}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Hint footer */}
      {colunas.length > 0 ? (
        <div className="text-xs text-foreground/50 px-1">
          🔴 célula vazia = não testado · clique pra criar · clique numa célula preenchida pra editar
        </div>
      ) : null}
    </div>
  );
}

// ====================== Cell components ======================

function CellPreenchida({
  angulo,
  personaCor,
  onClick,
}: {
  angulo: Angulo;
  personaCor: string;
  onClick: () => void;
}) {
  const cr = angulo.criativos?.[0];
  const thumb = cr?.thumbUrl ?? cr?.url ?? null;
  const dotCor = STATUS_DOT[angulo.status];

  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-md border border-border bg-background hover:border-foreground/30 transition-colors p-2 flex flex-col gap-1.5 group"
    >
      {/* Status + ROAS */}
      <div className="flex items-center justify-between gap-1">
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider">
          <span
            className="size-1.5 rounded-full"
            style={{ background: dotCor }}
          />
          <span style={{ color: dotCor }}>{STATUS_LABEL[angulo.status]}</span>
        </span>
        {angulo.roas != null ? (
          <span className="font-mono text-[10px] font-bold flex items-center gap-0.5 text-emerald-400">
            <TrendingUp className="size-2.5" />
            {angulo.roas.toFixed(1)}x
          </span>
        ) : null}
      </div>

      {/* Thumb + LP */}
      <div className="flex items-center gap-1.5">
        <div
          className="size-8 shrink-0 rounded bg-muted overflow-hidden grid place-items-center text-foreground/40 border"
          style={{ borderColor: `${personaCor}30` }}
        >
          {thumb ? (
            <img
              src={thumb}
              alt=""
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <ImageIcon className="size-3" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {angulo.lpUrl ? (
            <div className="text-[10px] font-mono text-foreground/70 truncate flex items-center gap-0.5">
              <ExternalLink className="size-2.5 shrink-0" />
              {shortLp(angulo.lpUrl)}
            </div>
          ) : (
            <div className="text-[10px] font-mono text-foreground/40 italic">
              sem LP
            </div>
          )}
          {/* Métricas extras */}
          {angulo.ctr != null || angulo.cpa != null ? (
            <div className="text-[9px] text-foreground/50 font-mono flex gap-1.5">
              {angulo.ctr != null ? <span>{angulo.ctr.toFixed(1)}%</span> : null}
              {angulo.cpa != null ? (
                <span>R${angulo.cpa.toFixed(0)}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </button>
  );
}

function CellVazia({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full h-full min-h-[68px] rounded-md border border-dashed border-border/60 bg-background/40 hover:border-foreground/40 hover:bg-background transition-colors flex items-center justify-center group"
      title="Criar este ângulo pra essa persona"
    >
      <div className="flex flex-col items-center gap-1 text-foreground/30 group-hover:text-foreground/60 transition-colors">
        <Plus className="size-3.5" />
        <span className="text-[9px] font-mono">vazio</span>
      </div>
    </button>
  );
}

function StatTile({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "emerald" | "yellow" | "red";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-500/30 bg-emerald-500/5"
      : tone === "yellow"
        ? "border-yellow-500/30 bg-yellow-500/5"
        : tone === "red"
          ? "border-red-500/30 bg-red-500/5"
          : "border-border bg-card";
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <div className="text-[10px] text-foreground/60 uppercase tracking-wider font-bold">
        {label}
      </div>
      <div className="text-2xl font-bold mt-0.5">{value}</div>
      {hint ? (
        <div className="text-[10px] text-foreground/50 font-mono mt-0.5">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function shortLp(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname || "/").slice(0, 18);
  } catch {
    return url.slice(0, 18);
  }
}
