import { useMemo, useState } from "react";
import { ImageIcon, ExternalLink, Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Angulo, Persona } from "@shared/types";

type PickerMode = "criativo" | "pagina";

export function MindmapPickerDialog({
  open,
  mode,
  angulos,
  personas,
  onClose,
  onPick,
  onClear,
}: {
  open: boolean;
  mode: PickerMode;
  angulos: Angulo[];
  personas: Persona[];
  onClose: () => void;
  /** Salva a escolha (string = id do criativo OU url da LP) */
  onPick: (value: string) => void;
  /** Limpa a escolha pra voltar ao auto */
  onClear: () => void;
}) {
  const [search, setSearch] = useState("");

  const personaById = useMemo(() => {
    const m = new Map<number, Persona>();
    for (const p of personas) m.set(p.id, p);
    return m;
  }, [personas]);

  const items = useMemo(() => {
    if (mode === "criativo") {
      // Lista todos os criativos de todos os ângulos
      const out: Array<{
        key: string;
        thumb: string | null;
        label: string;
        sub: string | null;
        meta: string | null;
        cor: string;
      }> = [];
      for (const a of angulos) {
        const persona = a.personaId ? personaById.get(a.personaId) : null;
        const cor = persona?.cor ?? "#71717a";
        for (const c of a.criativos ?? []) {
          out.push({
            key: String(c.id),
            thumb: c.thumbUrl ?? c.url ?? null,
            label: c.headlineOverlay ?? `Criativo #${c.id}`,
            sub: a.nome,
            meta: persona ? persona.nome : null,
            cor,
          });
        }
      }
      return out;
    } else {
      // LPs únicas extraídas dos angulos.lpUrl
      const seen = new Set<string>();
      const out: Array<{
        key: string;
        thumb: string | null;
        label: string;
        sub: string | null;
        meta: string | null;
        cor: string;
      }> = [];
      for (const a of angulos) {
        if (!a.lpUrl || seen.has(a.lpUrl)) continue;
        seen.add(a.lpUrl);
        const persona = a.personaId ? personaById.get(a.personaId) : null;
        out.push({
          key: a.lpUrl,
          thumb: a.lpScreenshot ?? null,
          label: shortLp(a.lpUrl),
          sub: a.lpUrl,
          meta: persona ? `Usada por ${persona.nome}` : null,
          cor: persona?.cor ?? "#3b82f6",
        });
      }
      return out;
    }
  }, [mode, angulos, personaById]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) =>
      [it.label, it.sub, it.meta]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q)),
    );
  }, [items, search]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-[min(900px,92vw)] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "criativo" ? (
              <>
                <ImageIcon className="size-4" />
                Escolher criativo
              </>
            ) : (
              <>
                <ExternalLink className="size-4" />
                Escolher página
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-foreground/40" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={
                mode === "criativo"
                  ? "Buscar por headline, ângulo, persona..."
                  : "Buscar por LP..."
              }
              className="pl-8 h-9 text-sm"
            />
          </div>
          <div className="text-[11px] text-foreground/50 mt-1 font-mono">
            {filtered.length} {mode === "criativo" ? "criativo(s)" : "LP(s)"}{" "}
            disponíveis
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-12 text-center text-sm text-foreground/60">
            {items.length === 0 ? (
              <>
                Nenhum{" "}
                {mode === "criativo"
                  ? "criativo cadastrado"
                  : "LP definida nos ângulos"}{" "}
                ainda.
                <br />
                <span className="text-xs text-foreground/40">
                  {mode === "criativo"
                    ? "Importe do Meta Ads ou cadastre via Board."
                    : "Cadastre uma LP nos ângulos via Board."}
                </span>
              </>
            ) : (
              "Nenhum resultado pra essa busca."
            )}
          </div>
        ) : (
          <div
            className={`grid ${mode === "criativo" ? "grid-cols-2 md:grid-cols-3" : "grid-cols-1 md:grid-cols-2"} gap-3 max-h-[55vh] overflow-y-auto pr-1`}
          >
            {filtered.map((it) => (
              <button
                key={it.key}
                onClick={() => {
                  onPick(it.key);
                  onClose();
                }}
                className="text-left rounded-md border border-border bg-card hover:border-foreground/30 hover:bg-card/80 transition-colors p-2 flex flex-col gap-2 group"
              >
                <div
                  className="aspect-video rounded bg-muted overflow-hidden grid place-items-center text-foreground/40"
                  style={{ borderColor: `${it.cor}30` }}
                >
                  {it.thumb ? (
                    <img
                      src={it.thumb}
                      alt={it.label}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-1">
                      {mode === "criativo" ? (
                        <ImageIcon className="size-5" />
                      ) : (
                        <ExternalLink className="size-5" />
                      )}
                      <span className="text-[9px] font-mono uppercase">
                        {mode === "criativo" ? "AD" : "LP"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="px-1">
                  <div className="text-[12px] font-bold truncate">
                    {it.label}
                  </div>
                  {it.sub ? (
                    <div className="text-[10px] text-foreground/60 truncate font-mono">
                      {it.sub}
                    </div>
                  ) : null}
                  {it.meta ? (
                    <div
                      className="text-[10px] truncate mt-0.5"
                      style={{ color: it.cor }}
                    >
                      {it.meta}
                    </div>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        )}

        <DialogFooter className="mt-3 flex flex-row items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onClear();
              onClose();
            }}
            className="text-foreground/60"
          >
            <X className="size-3.5 mr-1" /> Limpar (volta pra auto)
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function shortLp(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname && u.pathname !== "/" ? u.pathname : u.hostname;
  } catch {
    return url.length > 28 ? url.slice(0, 28) + "…" : url;
  }
}
