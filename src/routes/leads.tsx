import { useQuery } from "@tanstack/react-query";
import { Search, Filter, Plus, List, LayoutGrid } from "lucide-react";
import { useState } from "react";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import { STATUS_LABEL, STATUS_COLOR } from "@shared/labels";
import type { LeadStatus } from "@shared/labels";
import { FunilBoard } from "@/components/funil-board";

type View = "table" | "funil";

type Lead = {
  id: number;
  nome: string;
  contato: string | null;
  status: LeadStatus;
  valorAssinatura: number | null;
  criadoEm: string;
};

// Formata em horário de Brasília (BRT/America/Sao_Paulo)
const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatDateBR(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: "—", time: "" };
  return { date: dateFmt.format(d), time: timeFmt.format(d) };
}

export function LeadsPage() {
  const { produtoId } = useProdutoContext();
  const produtoParam = produtoId ?? "all";
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("funil");

  const { data, isLoading, error } = useQuery({
    queryKey: ["leads", produtoParam],
    queryFn: () => api.get<Lead[]>(`/api/leads?produtoId=${produtoParam}`),
  });

  const filtered = (data ?? []).filter((l) =>
    search ? l.nome.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <div className="space-y-5">
      {/* Header com toggle de view */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {data ? `${data.length} leads no total` : "Carregando..."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Toggle Funil/Tabela */}
          <div className="flex items-center bg-card border border-border rounded-2xl p-1 gap-1">
            <ViewToggle
              active={view === "funil"}
              onClick={() => setView("funil")}
              icon={LayoutGrid}
              label="Funil"
            />
            <ViewToggle
              active={view === "table"}
              onClick={() => setView("table")}
              icon={List}
              label="Tabela"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-all">
            <Plus className="size-4" />
            Novo lead
          </button>
        </div>
      </div>

      {/* Funil view */}
      {view === "funil" ? <FunilBoard /> : null}

      {/* Tabela view */}
      {view === "table" ? (
        <>
          <div className="card-soft p-2 flex items-center gap-2">
            <div className="size-10 rounded-xl bg-secondary grid place-items-center shrink-0">
              <Search className="size-4 text-foreground/60" />
            </div>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome..."
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            />
            <button className="size-10 rounded-xl bg-secondary hover:bg-lime-soft grid place-items-center shrink-0 transition-colors">
              <Filter className="size-4 text-foreground/60" />
            </button>
          </div>

      {isLoading ? (
        <div className="card-soft p-8 text-center text-sm text-muted-foreground">
          Carregando...
        </div>
      ) : error ? (
        <div className="card-soft p-8 text-center text-sm text-destructive">
          {error instanceof Error ? error.message : "Erro ao carregar"}
        </div>
      ) : (
        <div className="card-soft overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-4 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Nome
                </th>
                <th className="text-left px-6 py-4 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Contato
                </th>
                <th className="text-left px-6 py-4 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-6 py-4 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Data
                </th>
                <th className="text-right px-6 py-4 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Valor
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                const { date, time } = formatDateBR(l.criadoEm);
                return (
                  <tr
                    key={l.id}
                    className="border-b border-border/50 last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="size-9 rounded-xl bg-lime-soft grid place-items-center text-forest font-semibold text-xs">
                          {l.nome.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-medium">{l.nome}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-muted-foreground">{l.contato ?? "—"}</td>
                    <td className="px-6 py-4">
                      <span
                        className={`text-xs font-medium px-2.5 py-1 rounded-lg ${STATUS_COLOR[l.status] ?? "bg-muted text-foreground"}`}
                      >
                        {STATUS_LABEL[l.status] ?? l.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm tabular-nums text-foreground">{date}</div>
                      <div className="text-xs tabular-nums text-muted-foreground">{time}</div>
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums font-medium">
                      {l.valorAssinatura
                        ? l.valorAssinatura.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })
                        : "—"}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-muted-foreground text-sm">
                    Nenhum lead encontrado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
        </>
      ) : null}
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof List;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-foreground/70 hover:text-foreground hover:bg-muted/50"
      }`}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}
