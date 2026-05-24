import { ExternalLink, Home, Newspaper, TrendingUp, Building2, HelpCircle, Palette, Handshake, Download } from "lucide-react";

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

export function PaginasPage() {
  const total = SECTIONS.reduce((acc, s) => {
    if (s.pages) return acc + s.pages.length;
    if (s.groups) return acc + s.groups.reduce((a, g) => a + g.pages.length, 0);
    return acc;
  }, 0);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Páginas</h1>
        <p className="text-sm text-muted-foreground">
          Todas as landing pages publicadas em produção · <strong>{total} páginas</strong> · domínio <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{BASE_URL}</code>
        </p>
      </header>

      <div className="space-y-8">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const sectionTotal = section.pages?.length ?? section.groups?.reduce((a, g) => a + g.pages.length, 0) ?? 0;
          return (
            <section key={section.title}>
              <div className="flex items-center gap-2 mb-3">
                <Icon className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </h2>
                <span className="text-xs text-muted-foreground/60">
                  {sectionTotal} {sectionTotal === 1 ? "página" : "páginas"}
                </span>
              </div>

              {/* Layout 1: lista simples */}
              {section.pages && (
                <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                  {section.pages.map((page) => (
                    <PageRow key={page.slug} page={page} />
                  ))}
                </div>
              )}

              {/* Layout 2: múltiplos grupos lado a lado */}
              {section.groups && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {section.groups.map((group) => (
                    <div key={group.title}>
                      <h3 className="text-xs font-semibold text-foreground/70 mb-2 px-1">
                        {group.title} <span className="text-muted-foreground/60 font-normal">· {group.pages.length}</span>
                      </h3>
                      <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                        {group.pages.map((page) => (
                          <PageRow key={page.slug} page={page} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
