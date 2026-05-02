import { useState } from "react";
import { ChevronDown, Check, Layers } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";
import type { Produto } from "@shared/types";

const FALLBACK_COLOR = "oklch(0.86 0.18 130)";

export function ProductSwitcher() {
  const [open, setOpen] = useState(false);
  const { produtoId, setProdutoId } = useProdutoContext();
  const { data } = useQuery({
    queryKey: ["produtos"],
    queryFn: () => api.get<Produto[]>("/api/produtos"),
    staleTime: 5 * 60 * 1000,
  });

  const produtos = data ?? [];
  const selected = produtos.find((p) => p.id === produtoId) ?? null;
  const label = selected?.nome ?? "Todos os produtos";
  const dot = selected?.cor ?? FALLBACK_COLOR;

  function pick(id: number | null) {
    setProdutoId(id);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-card border border-border text-foreground text-sm font-medium hover:border-foreground/20 transition-colors"
      >
        {selected ? (
          <span
            className="size-3 rounded-full shrink-0"
            style={{ backgroundColor: dot }}
          />
        ) : (
          <Layers className="size-4 text-foreground/70" />
        )}
        <span className="max-w-[160px] truncate">{label}</span>
        <ChevronDown
          className={`size-4 text-foreground/60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 right-0 top-full mt-2 min-w-[240px] rounded-2xl border bg-popover shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95">
            <DropdownItem
              active={produtoId == null}
              onClick={() => pick(null)}
              icon={<Layers className="size-3.5" />}
              label="Todos os produtos"
              hint="Visão agregada"
            />
            {produtos.length > 0 ? (
              <div className="my-1 border-t border-border" />
            ) : null}
            {produtos.map((p) => (
              <DropdownItem
                key={p.id}
                active={produtoId === p.id}
                onClick={() => pick(p.id)}
                icon={
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: p.cor ?? FALLBACK_COLOR }}
                  />
                }
                label={p.nome}
                hint={tipoLabel(p.tipo)}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function DropdownItem({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-colors ${
        active ? "bg-secondary" : "hover:bg-muted"
      }`}
    >
      <span className="size-7 rounded-lg bg-muted/40 grid place-items-center shrink-0">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-medium truncate">{label}</span>
        {hint ? (
          <span className="block text-xs text-muted-foreground truncate">{hint}</span>
        ) : null}
      </span>
      {active ? <Check className="size-4 text-foreground/70 shrink-0" /> : null}
    </button>
  );
}

function tipoLabel(tipo: Produto["tipo"]): string {
  switch (tipo) {
    case "saas":
      return "Assinatura recorrente";
    case "curso":
      return "Curso / produto digital";
    case "digital":
      return "Produto digital";
    default:
      return "Sem classificação";
  }
}
