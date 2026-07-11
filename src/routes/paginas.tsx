import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Home, Newspaper, TrendingUp, Building2, HelpCircle, Palette, Handshake, Download, ChevronDown, ClipboardList, Check } from "lucide-react";
import { api } from "@/lib/api";
import { LeadDetailsModal } from "@/components/lead-details-modal";

type Page = {
  slug: string;
  desc: string;
};

type SubGroup = {
  title: string;
  pages: Page[];
};

type Section = {
  title: string;
  icon: typeof Home;
  // Pode ser uma lista simples de páginas OU múltiplos sub-grupos lado-a-lado
  pages?: Page[];
  groups?: SubGroup[];
};

const SECTIONS: Section[] = [
  {
    title: "Principal",
    icon: Home,
    pages: [
      { slug: "/", desc: "Home (toggle créditos vs BYOK)" },
      { slug: "/yt", desc: "Clone da home pra rastrear YouTube (UTM auto)" },
      { slug: "/obrigado", desc: "Pós-checkout (Pixel Purchase + CAPI dedup)" },
    ],
  },
  {
    title: "Notícia (advertorial)",
    icon: Newspaper,
    pages: [
      { slug: "/ag-noticia-v1", desc: "Estilo portal de notícia — agência" },
    ],
  },
  {
    title: "Gestor de Tráfego",
    icon: TrendingUp,
    pages: [
      { slug: "/gt-meta-v1-byok-vsl", desc: "Foco em conversão + Meta Ads" },
    ],
  },
  {
    title: "Agência",
    icon: Building2,
    groups: [
      {
        title: "BYOK (chave API)",
        pages: [
          { slug: "/ag-escala-v1-byok-vsl", desc: "Escala + VSL" },
          { slug: "/ag-escala-v1-byok-long", desc: "Escala + página longa" },
          { slug: "/ag-escala-v1-byok-demo", desc: "Demo (preview de planos)" },
          { slug: "/ag-escala-v1-byok-quiz", desc: "Escala + quiz embutido" },
          { slug: "/ag-velocidade-v1-byok-long", desc: "Velocidade de produção" },
          { slug: "/ag-controle-v1-byok-long", desc: "Controle total da criação" },
          { slug: "/ag-gargalo-v1-byok-vsl", desc: "Gargalo de criativos" },
          { slug: "/ag-criativos-v1", desc: "Foco em criativos (imagem + vídeo)" },
        ],
      },
      {
        title: "Créditos",
        pages: [
          { slug: "/ag-escala-v1-creditos-vsl", desc: "Escala + VSL" },
          { slug: "/ag-escala-v1-creditos-long", desc: "Escala + longa" },
          { slug: "/ag-assinaturas-v1-creditos", desc: "'Pare de assinar várias ferramentas'" },
        ],
      },
    ],
  },
  {
    title: "Quiz (diagnóstico)",
    icon: HelpCircle,
    pages: [
      { slug: "/ag-quiz", desc: "Quiz → recomenda BYOK" },
      { slug: "/ag-quiz-creditos", desc: "Quiz → recomenda Créditos" },
    ],
  },
  {
    title: "Designer Freelancer",
    icon: Palette,
    pages: [
      { slug: "/df-controle-v1-byok-long", desc: "DF + controle" },
    ],
  },
  {
    title: "Afiliados (Ticto)",
    icon: Handshake,
    pages: [
      { slug: "/af", desc: "BYOK (R$ 67 mensal / R$ 397 anual)" },
      { slug: "/af2", desc: "Créditos (Starter / Premium / Enterprise)" },
    ],
  },
  {
    title: "Captura (lead magnet)",
    icon: Download,
    pages: [
      { slug: "/captura-carrossel", desc: "Captura → carrossel" },
      { slug: "/captura-video", desc: "Captura → vídeo" },
    ],
  },
];

const BASE_URL = "https://gravyx.com.br";

function PageRow({ page }: { page: Page }) {
  return (
    <a
      href={`${BASE_URL}${page.slug}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <code className="text-sm font-mono font-semibold text-foreground truncate">
            {page.slug}
          </code>
          <ExternalLink className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{page.desc}</p>
      </div>
    </a>
  );
}

type FormSubmission = {
  leadId: number;
  nome: string | null;
  email: string | null;
  whatsapp: string | null;
  plano: string | null;
  lp: string | null;
  quando: string;
  leadStatus: string | null;
  comprou: boolean;
  respondeu: boolean;
};

const dtFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
});

function fmtWhats(w: string | null): string {
  if (!w) return "—";
  const d = w.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d;
  if (local.length >= 10) {
    const ddd = local.slice(0, 2);
    const sub = local.slice(2);
    return `(${ddd}) ${sub.slice(0, sub.length - 4)}-${sub.slice(-4)}`;
  }
  return "+" + d;
}

function FormSubmissionsCard({ onLeadClick }: { onLeadClick: (id: number) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ["form-submissions"],
    queryFn: () => api.get<FormSubmission[]>("/api/dashboard/form-submissions"),
    refetchInterval: 30_000,
  });

  return (
    <section className="card-soft mb-8 overflow-hidden">
      <div className="px-5 py-4 border-b border-border/60 flex items-center gap-3">
        <div className="size-9 rounded-2xl bg-lime-soft text-forest grid place-items-center">
          <ClipboardList className="size-4" />
        </div>
        <div>
          <h2 className="text-sm font-bold">Preenchimentos do form</h2>
          <p className="text-xs text-muted-foreground">
            Quem preencheu o pop-up das páginas{data ? ` · ${data.length}` : ""} · atualiza a cada 30s
          </p>
        </div>
      </div>
      {isLoading ? (
        <p className="text-sm text-muted-foreground p-6 text-center">Carregando…</p>
      ) : !data || data.length === 0 ? (
        <p className="text-sm text-muted-foreground p-6 text-center">Nenhum preenchimento ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-muted-foreground text-left border-b border-border/40">
                <th className="px-4 py-2 font-medium whitespace-nowrap">Quando</th>
                <th className="px-4 py-2 font-medium">Nome</th>
                <th className="px-4 py-2 font-medium">WhatsApp</th>
                <th className="px-4 py-2 font-medium">E-mail</th>
                <th className="px-4 py-2 font-medium">Plano</th>
                <th className="px-4 py-2 font-medium">LP</th>
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr
                  key={s.leadId}
                  onClick={() => onLeadClick(s.leadId)}
                  className="border-b border-border/30 hover:bg-muted/30 cursor-pointer"
                >
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground whitespace-nowrap">{dtFmt.format(new Date(s.quando))}</td>
                  <td className="px-4 py-2.5 font-medium truncate max-w-[180px]">{s.nome || "—"}</td>
                  <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{fmtWhats(s.whatsapp)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[220px]">{s.email || "—"}</td>
                  <td className="px-4 py-2.5 text-muted-foreground truncate max-w-[120px]">{s.plano || "—"}</td>
                  <td className="px-4 py-2.5"><code className="text-xs text-muted-foreground">{s.lp || "—"}</code></td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    {s.comprou ? (
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-lime-soft text-forest inline-flex items-center gap-1"><Check className="size-3" />Comprou</span>
                    ) : s.respondeu ? (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-secondary text-foreground/80">Respondeu</span>
                    ) : (
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-muted text-muted-foreground">Pendente</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function PaginasPage() {
  const [selectedLead, setSelectedLead] = useState<number | null>(null);
  const total = SECTIONS.reduce((acc, s) => {
    if (s.pages) return acc + s.pages.length;
    if (s.groups) return acc + s.groups.reduce((a, g) => a + g.pages.length, 0);
    return acc;
  }, 0);

  // Estado das seções abertas — começam todas fechadas (clique pra expandir)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});

  function toggle(title: string) {
    setOpenSections((prev) => ({ ...prev, [title]: !prev[title] }));
  }

  function expandAll() {
    const all: Record<string, boolean> = {};
    SECTIONS.forEach((s) => { all[s.title] = true; });
    setOpenSections(all);
  }

  function collapseAll() {
    setOpenSections({});
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold mb-2">Páginas</h1>
          <p className="text-sm text-muted-foreground">
            Todas as landing pages publicadas em produção · <strong>{total} páginas</strong> · domínio <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{BASE_URL}</code>
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={expandAll}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Expandir tudo
          </button>
          <span className="text-muted-foreground/30">|</span>
          <button
            onClick={collapseAll}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Recolher tudo
          </button>
        </div>
      </header>

      <FormSubmissionsCard onLeadClick={setSelectedLead} />

      <div className="space-y-2">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const sectionTotal = section.pages?.length ?? section.groups?.reduce((a, g) => a + g.pages.length, 0) ?? 0;
          const isOpen = !!openSections[section.title];
          return (
            <section key={section.title} className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => toggle(section.title)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
              >
                <Icon className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-foreground flex-1">
                  {section.title}
                </h2>
                <span className="text-xs text-muted-foreground/70">
                  {sectionTotal} {sectionTotal === 1 ? "página" : "páginas"}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground transition-transform flex-shrink-0 ${isOpen ? "rotate-180" : ""}`}
                />
              </button>

              {isOpen && (
                <div className="border-t border-border bg-muted/10 p-3">
                  {/* Layout 1: lista simples */}
                  {section.pages && (
                    <div className="bg-background border border-border rounded-lg overflow-hidden divide-y divide-border">
                      {section.pages.map((page) => (
                        <PageRow key={page.slug} page={page} />
                      ))}
                    </div>
                  )}

                  {/* Layout 2: múltiplos grupos lado a lado */}
                  {section.groups && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {section.groups.map((group) => (
                        <div key={group.title}>
                          <h3 className="text-xs font-semibold text-foreground/70 mb-2 px-1">
                            {group.title} <span className="text-muted-foreground/60 font-normal">· {group.pages.length}</span>
                          </h3>
                          <div className="bg-background border border-border rounded-lg overflow-hidden divide-y divide-border">
                            {group.pages.map((page) => (
                              <PageRow key={page.slug} page={page} />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {selectedLead !== null && (
        <LeadDetailsModal leadId={selectedLead} onClose={() => setSelectedLead(null)} />
      )}
    </div>
  );
}
