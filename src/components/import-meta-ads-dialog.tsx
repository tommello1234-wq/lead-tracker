import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, ImageIcon, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import type { MetaAd, Persona } from "@shared/types";

const PERIOD_OPTIONS = [
  { label: "Últimos 30 dias", days: 30 },
  { label: "Últimos 60 dias", days: 60 },
  { label: "Últimos 90 dias", days: 90 },
  { label: "Últimos 180 dias", days: 180 },
  { label: "Tudo", days: null },
];

type Selection = {
  selected: boolean;
  personaId: number | null;
  nome: string;
};

export function ImportMetaAdsDialog({
  open,
  onClose,
  personas,
  produtoId,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  personas: Persona[];
  produtoId: number | null;
  onImported: () => void;
}) {
  const qc = useQueryClient();
  const [days, setDays] = useState<number | null>(90);
  const [onlyWithSpend, setOnlyWithSpend] = useState(true);
  const [selection, setSelection] = useState<Map<string, Selection>>(new Map());

  const since = useMemo(() => {
    if (days == null) return null;
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }, [days]);

  const adsQuery = useQuery({
    queryKey: ["meta-ads-importer", since, onlyWithSpend],
    queryFn: () => {
      const params = new URLSearchParams();
      if (since) params.set("since", since);
      if (onlyWithSpend) params.set("onlyWithSpend", "1");
      params.set("limit", "200");
      return api.get<MetaAd[]>(`/api/meta-ads/ads?${params.toString()}`);
    },
    enabled: open,
    staleTime: 60_000,
  });

  const ads = adsQuery.data ?? [];

  // Inicializa seleção quando recebe ads novos — auto-sugere persona baseado em
  // palavras-chave do criativo (headline, LP URL, nome do ad, campanha).
  useMemo(() => {
    if (!ads.length) return;
    setSelection((prev) => {
      const next = new Map(prev);
      for (const ad of ads) {
        if (!next.has(ad.adId)) {
          next.set(ad.adId, {
            selected: false,
            personaId: suggestPersonaId(ad, personas),
            nome: defaultAnguloName(ad),
          });
        }
      }
      return next;
    });
  }, [ads, personas]);

  const selectedCount = Array.from(selection.values()).filter((s) => s.selected).length;

  const importMut = useMutation({
    mutationFn: async () => {
      const items = ads
        .filter((ad) => selection.get(ad.adId)?.selected)
        .map((ad) => {
          const sel = selection.get(ad.adId)!;
          const tipo: "video" | "imagem" = ad.videoId ? "video" : "imagem";
          return {
            metaAdsId: ad.adId,
            nome: sel.nome.trim() || defaultAnguloName(ad),
            personaId: sel.personaId,
            hook: ad.headline ?? null,
            promessa: ad.body ?? null,
            lpUrl: ad.landingPageUrl,
            status:
              ad.status === "ACTIVE"
                ? ("rodando" as const)
                : ("pausado" as const),
            ctr: ad.ctr || null,
            cpa: ad.cpa,
            roas: ad.roas || null,
            criativo: {
              tipo,
              url: ad.videoId
                ? `https://www.facebook.com/video.php?v=${ad.videoId}`
                : ad.imageUrl,
              thumbUrl: ad.thumbnailUrl,
              headlineOverlay: ad.headline ?? null,
              ctr: ad.ctr || null,
              cpa: ad.cpa,
              impressoes: ad.impressions,
              lpViews: ad.landingPageViews || null,
              checkouts: ad.initiateCheckout || null,
              compras: ad.purchases || null,
            },
          };
        });
      return api.post<{ created: number; updated: number; skipped: number }>(
        "/api/angulos/import-from-meta",
        { produtoId, items },
      );
    },
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["angulos"] });
      alert(
        `Importados novos: ${r.created} · Atualizados (refresh de métricas): ${r.updated}`,
      );
      onImported();
    },
    onError: (e: unknown) => {
      alert(e instanceof Error ? e.message : "Erro ao importar");
    },
  });

  const toggleAll = (val: boolean) => {
    setSelection((prev) => {
      const next = new Map(prev);
      for (const [k, v] of next) next.set(k, { ...v, selected: val });
      return next;
    });
  };

  const updateSelection = (adId: string, patch: Partial<Selection>) => {
    setSelection((prev) => {
      const next = new Map(prev);
      const cur = next.get(adId);
      if (cur) next.set(adId, { ...cur, ...patch });
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="!max-w-[min(1400px,95vw)] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Download className="size-5" />
            Importar criativos do Meta Ads
          </DialogTitle>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex items-center gap-3 py-3 flex-wrap">
          <Select
            value={days == null ? "all" : String(days)}
            onValueChange={(v) => setDays(v === "all" ? null : Number(v))}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o) => (
                <SelectItem
                  key={o.days == null ? "all" : String(o.days)}
                  value={o.days == null ? "all" : String(o.days)}
                >
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={onlyWithSpend}
              onChange={(e) => setOnlyWithSpend(e.target.checked)}
            />
            Apenas com gasto
          </label>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => adsQuery.refetch()}
            disabled={adsQuery.isFetching}
          >
            <RefreshCw className={`size-3.5 mr-1 ${adsQuery.isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>

          <div className="flex-1" />

          <span className="text-xs text-foreground/60">
            {ads.length} ads · {selectedCount} selecionado(s)
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => toggleAll(true)}
            disabled={ads.length === 0}
          >
            Marcar todos
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => toggleAll(false)}
            disabled={selectedCount === 0}
          >
            Limpar
          </Button>
        </div>

        {/* Lista */}
        <div className="rounded-md border border-border overflow-hidden">
          {adsQuery.isLoading ? (
            <div className="p-12 grid place-items-center text-foreground/60 gap-2">
              <Loader2 className="size-5 animate-spin" />
              Carregando criativos do Meta…
            </div>
          ) : adsQuery.isError ? (
            <div className="p-8 text-red-400 text-sm text-center">
              Erro ao buscar Meta Ads: {String((adsQuery.error as Error)?.message)}
              <br />
              <span className="text-foreground/60 text-xs">
                Verifique se META_ACCESS_TOKEN está configurado no .env.local
              </span>
            </div>
          ) : ads.length === 0 ? (
            <div className="p-12 text-center text-foreground/60 text-sm">
              Nenhum ad encontrado no período.
            </div>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0 z-10">
                  <tr className="text-foreground/60 text-[10px] uppercase tracking-wider">
                    <th className="text-left px-2 py-2 w-10"></th>
                    <th className="text-left px-2 py-2">Criativo</th>
                    <th className="text-left px-2 py-2">Persona</th>
                    <th className="text-left px-2 py-2">Nome do ângulo</th>
                    <th className="text-right px-2 py-2 w-20">Spend</th>
                    <th className="text-right px-2 py-2 w-16">CTR</th>
                    <th className="text-right px-2 py-2 w-16">CPA</th>
                    <th className="text-right px-2 py-2 w-16">ROAS</th>
                  </tr>
                </thead>
                <tbody>
                  {ads.map((ad) => {
                    const sel = selection.get(ad.adId);
                    return (
                      <tr
                        key={ad.adId}
                        className="border-t border-border hover:bg-muted/40"
                      >
                        <td className="px-2 py-2 align-top">
                          <input
                            type="checkbox"
                            checked={sel?.selected ?? false}
                            onChange={(e) =>
                              updateSelection(ad.adId, {
                                selected: e.target.checked,
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex gap-2 items-start">
                            <div className="size-12 shrink-0 rounded bg-muted overflow-hidden grid place-items-center text-foreground/40">
                              {ad.thumbnailUrl ? (
                                <img
                                  src={ad.thumbnailUrl}
                                  alt={ad.adName}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <ImageIcon className="size-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="font-semibold text-foreground line-clamp-1">
                                {ad.adName}
                              </div>
                              {ad.headline ? (
                                <div className="text-foreground/70 text-[11px] line-clamp-1 italic">
                                  "{ad.headline}"
                                </div>
                              ) : null}
                              <div className="text-foreground/50 text-[10px] flex items-center gap-2 mt-0.5">
                                <span>{ad.campaignName}</span>
                                {ad.landingPageUrl ? (
                                  <a
                                    href={ad.landingPageUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:text-foreground inline-flex items-center gap-0.5"
                                  >
                                    <ExternalLink className="size-2.5" />
                                    {shortLp(ad.landingPageUrl)}
                                  </a>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2 align-top">
                          {(() => {
                            const personaSelecionada =
                              sel?.personaId != null
                                ? personas.find((p) => p.id === sel.personaId)
                                : null;
                            return (
                              <Select
                                value={
                                  sel?.personaId == null
                                    ? "_"
                                    : String(sel.personaId)
                                }
                                onValueChange={(v) =>
                                  updateSelection(ad.adId, {
                                    personaId: v === "_" ? null : Number(v),
                                  })
                                }
                              >
                                <SelectTrigger className="h-8 text-xs">
                                  {personaSelecionada ? (
                                    <span className="flex items-center gap-1.5 truncate">
                                      <span
                                        className="size-2 rounded-full shrink-0"
                                        style={{
                                          background:
                                            personaSelecionada.cor ?? "#71717a",
                                        }}
                                      />
                                      <span className="truncate">
                                        {personaSelecionada.nome}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="text-foreground/50">
                                      — sem persona —
                                    </span>
                                  )}
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="_">
                                    — sem persona —
                                  </SelectItem>
                                  {personas.map((p) => (
                                    <SelectItem key={p.id} value={String(p.id)}>
                                      <span className="flex items-center gap-1.5">
                                        <span
                                          className="size-2 rounded-full shrink-0"
                                          style={{ background: p.cor ?? "#71717a" }}
                                        />
                                        {p.nome}
                                      </span>
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            );
                          })()}
                        </td>
                        <td className="px-2 py-2 align-top">
                          <Input
                            value={sel?.nome ?? ""}
                            onChange={(e) =>
                              updateSelection(ad.adId, { nome: e.target.value })
                            }
                            className="h-8 text-xs"
                            placeholder={defaultAnguloName(ad)}
                          />
                        </td>
                        <td className="text-right px-2 py-2 font-mono text-[11px] align-top">
                          R${ad.spend.toFixed(0)}
                        </td>
                        <td className="text-right px-2 py-2 font-mono text-[11px] align-top">
                          {ad.ctr ? `${ad.ctr.toFixed(1)}%` : "—"}
                        </td>
                        <td className="text-right px-2 py-2 font-mono text-[11px] align-top">
                          {ad.cpa ? `R$${ad.cpa.toFixed(0)}` : "—"}
                        </td>
                        <td className="text-right px-2 py-2 font-mono text-[11px] align-top">
                          {ad.roas ? `${ad.roas.toFixed(1)}x` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter className="mt-3">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={selectedCount === 0 || importMut.isPending}
            onClick={() => importMut.mutate()}
          >
            {importMut.isPending
              ? "Importando…"
              : `Importar ${selectedCount} ângulo(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function defaultAnguloName(ad: MetaAd): string {
  // Tenta extrair "tema" do nome do ad.
  // Ex: "Gravyx_Tráfego_Velocidade_v2" → "Velocidade"
  const parts = ad.adName.split(/[_·\-|]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) return parts[parts.length - 2] || parts[parts.length - 1] || ad.adName;
  if (ad.headline) return ad.headline.slice(0, 40);
  return ad.adName.slice(0, 40);
}

/**
 * Sugere persona pra um ad baseado em pistas no criativo:
 * - LP URL (`/designer`, `/emp-v1`, `/plano-custom`, etc.)
 * - Palavras-chave no ad name, headline, body, campaign name
 *
 * Não tem ranking — primeira regra que matchar ganha. Ordem por especificidade.
 */
function suggestPersonaId(ad: MetaAd, personas: Persona[]): number | null {
  if (personas.length === 0) return null;
  const haystack = [
    ad.adName,
    ad.headline,
    ad.body,
    ad.landingPageUrl,
    ad.campaignName,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const findByName = (re: RegExp) =>
    personas.find((p) => re.test(p.nome.toLowerCase()))?.id ?? null;

  // Designer — LP /designer ou texto explícito
  if (/\/designer|\bdesigner\b/.test(haystack)) {
    const id = findByName(/designer/);
    if (id) return id;
  }
  // Agência — LPs emp-v1/v2 com tag "agência" OU texto explícito
  if (/agencia|agência|\bag[eê]ncia\b/.test(haystack)) {
    const id = findByName(/ag[eê]ncia/);
    if (id) return id;
  }
  // Tráfego — gestor de tráfego, gestor de mídia
  if (/\bg(estor|estora) de (tr[áa]fego|m[íi]dia)\b|\btr[áa]fego\b/.test(haystack)) {
    const id = findByName(/tr[áa]fego/);
    if (id) return id;
  }
  // Social Media
  if (/\bsocial media\b|\bcommunity\b|\bsocial\s*midia\b/.test(haystack)) {
    const id = findByName(/social/);
    if (id) return id;
  }
  // Criador de conteúdo
  if (/\bcriador\b|\bcontentcreator\b|\binfluenc/.test(haystack)) {
    const id = findByName(/criador|conte[úu]do/);
    if (id) return id;
  }
  // LP /emp-v1 ou /emp-v2 sem keyword específica → Agência (LP é orientada agência)
  if (/\/emp-v[12]\b/.test(haystack)) {
    const id = findByName(/ag[eê]ncia/);
    if (id) return id;
  }
  // /plano-custom, /vsl, /captura → Empreendedor solo (foco custo/escala)
  if (
    /\/plano-custom|\/vsl|\/captura|centavos|\beconom/.test(haystack) ||
    /empreendedor/.test(haystack)
  ) {
    const id = findByName(/empreendedor/);
    if (id) return id;
  }
  return null;
}

function shortLp(url: string): string {
  try {
    const u = new URL(url);
    return (u.pathname || "/").slice(0, 24);
  } catch {
    return url.slice(0, 24);
  }
}
