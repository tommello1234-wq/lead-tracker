import { ExternalLink, Home, Newspaper, TrendingUp, Building2, CreditCard, HelpCircle, Palette, Handshake, Download } from "lucide-react";

type Page = {
  slug: string;
  desc: string;
};

type Section = {
  title: string;
  icon: typeof Home;
  pages: Page[];
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
    title: "Agência — BYOK (chave API)",
    icon: Building2,
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
    title: "Agência — Créditos",
    icon: CreditCard,
    pages: [
      { slug: "/ag-escala-v1-creditos-vsl", desc: "Escala + VSL" },
      { slug: "/ag-escala-v1-creditos-long", desc: "Escala + longa" },
      { slug: "/ag-assinaturas-v1-creditos", desc: "'Pare de assinar várias ferramentas'" },
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

export function PaginasPage() {
  const total = SECTIONS.reduce((acc, s) => acc + s.pages.length, 0);

  return (
    <div className="container mx-auto p-6 max-w-5xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold mb-2">Páginas</h1>
        <p className="text-sm text-muted-foreground">
          Todas as landing pages publicadas em produção · <strong>{total} páginas</strong> · domínio <code className="text-xs bg-muted px-1.5 py-0.5 rounded">{BASE_URL}</code>
        </p>
      </header>

      <div className="space-y-8">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <section key={section.title}>
              <div className="flex items-center gap-2 mb-3">
                <Icon className="w-4 h-4 text-emerald-400" />
                <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </h2>
                <span className="text-xs text-muted-foreground/60">
                  {section.pages.length} {section.pages.length === 1 ? "página" : "páginas"}
                </span>
              </div>
              <div className="border border-border rounded-lg overflow-hidden divide-y divide-border">
                {section.pages.map((page) => (
                  <a
                    key={page.slug}
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
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {page.desc}
                      </p>
                    </div>
                  </a>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
