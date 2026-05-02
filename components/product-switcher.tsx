"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Layers, Package, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { setSelectedProdutoId } from "@/lib/produto-context";
import type { Produto } from "@/db/schema";

type Props = {
  produtos: Produto[];
  selectedId: number | null;
  collapsed?: boolean;
};

const TYPE_LABEL: Record<string, string> = {
  saas: "SaaS",
  curso: "Curso",
  digital: "Digital",
  indefinido: "?",
};

export function ProductSwitcher({ produtos, selectedId, collapsed }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const selected = produtos.find((p) => p.id === selectedId);
  const label = selected?.nome ?? "Todos os produtos";
  const cor = selected?.cor ?? "#A4E440";

  function pick(id: number | null) {
    setOpen(false);
    startTransition(async () => {
      await setSelectedProdutoId(id);
    });
  }

  if (collapsed) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((s) => !s)}
          disabled={pending}
          className={cn(
            "size-10 mx-auto grid place-items-center rounded-xl transition-all",
            "bg-sidebar-accent hover:bg-sidebar-accent/80",
          )}
          title={label}
          style={{ color: cor }}
        >
          {selected ? <Package className="size-4" /> : <Layers className="size-4" />}
        </button>
        {open ? (
          <Dropdown
            produtos={produtos}
            selectedId={selectedId}
            onPick={pick}
            onClose={() => setOpen(false)}
            placement="right"
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        disabled={pending}
        className={cn(
          "w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all",
          "bg-sidebar-accent/40 hover:bg-sidebar-accent text-sidebar-foreground",
        )}
      >
        <span
          className="size-2.5 rounded-full shrink-0"
          style={{ backgroundColor: cor }}
        />
        <span className="flex-1 text-left truncate">{label}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <Dropdown
          produtos={produtos}
          selectedId={selectedId}
          onPick={pick}
          onClose={() => setOpen(false)}
          placement="below"
        />
      ) : null}
    </div>
  );
}

function Dropdown({
  produtos,
  selectedId,
  onPick,
  onClose,
  placement,
}: {
  produtos: Produto[];
  selectedId: number | null;
  onPick: (id: number | null) => void;
  onClose: () => void;
  placement: "below" | "right";
}) {
  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        className={cn(
          "absolute z-40 min-w-[220px] rounded-xl border bg-popover text-popover-foreground shadow-md py-1 animate-in fade-in-0 zoom-in-95",
          placement === "below" ? "top-full left-0 mt-1 w-full" : "left-full top-0 ml-2",
        )}
      >
        <button
          type="button"
          onClick={() => onPick(null)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left",
            selectedId == null && "font-medium",
          )}
        >
          <Layers className="size-3.5 text-muted-foreground" />
          <span className="flex-1">Todos os produtos</span>
          {selectedId == null ? <Check className="size-3.5" /> : null}
        </button>
        <div className="h-px bg-border mx-1 my-1" />
        {produtos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPick(p.id)}
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted text-left",
              selectedId === p.id && "font-medium",
            )}
          >
            <span
              className="size-2.5 rounded-full shrink-0"
              style={{ backgroundColor: p.cor ?? "#9CA3AF" }}
            />
            <div className="flex-1 min-w-0">
              <div className="truncate">{p.nome}</div>
              <div className="text-[10px] text-muted-foreground">
                {TYPE_LABEL[p.tipo] ?? p.tipo}
              </div>
            </div>
            {selectedId === p.id ? <Check className="size-3.5" /> : null}
          </button>
        ))}
      </div>
    </>
  );
}
