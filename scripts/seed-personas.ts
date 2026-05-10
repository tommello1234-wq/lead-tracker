/**
 * Seed inicial das personas — popula tabela com os 6 ICPs principais do Gravyx.
 * Executa sem duplicar (checa por nome+produtoId antes de inserir).
 *
 * Run: npx tsx --env-file=.env.local scripts/seed-personas.ts
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import { db } from "../db/client.js";
import { personas, produtos, type NovaPersona } from "../db/schema.js";
import { eq, and } from "drizzle-orm";

async function main() {
  // Acha o produto Gravyx (qualquer um que comece com "Gravyx")
  const allProdutos = await db.select().from(produtos);
  console.log(`[seed-personas] ${allProdutos.length} produtos encontrados.`);

  const gravyx = allProdutos.find((p) =>
    p.nome.toLowerCase().includes("gravyx"),
  );
  const produtoId = gravyx?.id ?? null;
  console.log(
    `[seed-personas] Usando produtoId=${produtoId} (${gravyx?.nome ?? "sem produto"})`,
  );

  const seedData: Omit<NovaPersona, "id" | "criadoEm" | "atualizadoEm">[] = [
    {
      produtoId,
      nome: "Gestor de Tráfego",
      cor: "#FF5566",
      descricao:
        "Profissional que gerencia campanhas pagas (Meta Ads, Google Ads) pra clientes ou negócio próprio.",
      demografia: "25-45 anos · Brasil · faturamento R$5-50k/mês",
      dor: "Precisa testar 20+ criativos por campanha pra encontrar o vencedor. Designer freelancer demora dias e cobra caro por variação.",
      desejo:
        "Subir 30 criativos por semana sem depender de ninguém, gastando centavos em geração.",
      objecoes: [
        "IA não tem qualidade visual suficiente",
        "Vou perder controle da criatividade",
        "Já tenho ferramentas como Canva",
      ],
      mensagemChave:
        "Teste 30 criativos por campanha sem depender de designer. Pague centavos por geração.",
      volumeMensal: "muito_alto",
      wtpEstimado: "alto",
      churnRisk: "baixo",
      pctPublicoAtual: 10,
      prioridade: "primaria",
      lps: ["/emp-v1"],
      canais: ["meta_ads", "comunidade_telegram", "indicacao"],
      notas:
        "ICP de maior LTV. Compra rápido se vê criativo bom. Foco principal de captação.",
      ativo: true,
    },
    {
      produtoId,
      nome: "Dono de Agência",
      cor: "#FFA500",
      descricao:
        "Dono ou sócio de agência de social media, tráfego ou marketing — atende vários clientes.",
      demografia: "28-50 anos · Brasil · agência com 5-30 clientes",
      dor: "Gargalo de produção pra atender N clientes. Cada cliente quer 20 peças/mês. Custo de equipe come a margem.",
      desejo:
        "Atender 3x mais clientes sem aumentar o time. Manter qualidade e identidade visual.",
      objecoes: [
        "Cliente pode não aceitar arte feita por IA",
        "Precisa garantir consistência entre peças",
        "Vai descaracterizar a marca do cliente",
      ],
      mensagemChave:
        "Atenda 3x mais clientes sem aumentar o time. Mesma qualidade, fração do custo.",
      volumeMensal: "muito_alto",
      wtpEstimado: "muito_alto",
      churnRisk: "baixo",
      pctPublicoAtual: 13,
      prioridade: "primaria",
      lps: ["/emp-v2"],
      canais: ["meta_ads", "linkedin", "instagram_organico"],
      notas:
        "Decisão mais lenta (cliente precisa aprovar), mas LTV altíssimo. Vale ter LP dedicada com case study.",
      ativo: true,
    },
    {
      produtoId,
      nome: "Designer Freelancer",
      cor: "#00A1FF",
      descricao:
        "Designer autônomo querendo escalar receita sem virar agência.",
      demografia: "22-40 anos · Brasil · faturamento R$3-15k/mês",
      dor: "Trabalho braçal demais — passa tempo em variação de peça em vez de no estratégico. IA é vista como ameaça mas pode ser aliada.",
      desejo:
        "Virar diretor criativo: dirige a IA e revisa output em vez de fazer peça do zero.",
      objecoes: [
        "IA vai substituir meu trabalho",
        "Cliente vai pagar menos sabendo que é IA",
        "Qualidade não vai chegar ao meu padrão",
      ],
      mensagemChave:
        "Designer, se torne um diretor criativo. Você dirige, a IA executa.",
      volumeMensal: "alto",
      wtpEstimado: "medio",
      churnRisk: "alto",
      pctPublicoAtual: 25,
      prioridade: "secundaria",
      lps: ["/designer"],
      canais: ["instagram_organico", "youtube", "comunidade_design"],
      notas:
        "Maior single bucket hoje (25%) mas churn risk alto — pode testar e cancelar. Crítico em qualidade visual.",
      ativo: true,
    },
    {
      produtoId,
      nome: "Empreendedor Solo",
      cor: "#FFD60A",
      descricao:
        "Dono de pequeno negócio que faz próprio marketing — não tem tempo nem budget pra equipe.",
      demografia:
        "30-55 anos · Brasil · faturamento R$10-100k/mês · time enxuto",
      dor: "Marketing depende dele, mas ele não é designer. Gasta horas no Canva pra fazer post razoável.",
      desejo:
        "Fazer marketing visual decente sem precisar contratar ou virar designer.",
      objecoes: [
        "Não sei usar IA, vai ser complicado",
        "Resultado não vai parecer profissional",
        "Já uso Canva, é suficiente",
      ],
      mensagemChave:
        "Faça o marketing do seu negócio sem contratar ninguém. Crie em minutos.",
      volumeMensal: "medio",
      wtpEstimado: "medio",
      churnRisk: "medio",
      pctPublicoAtual: 17,
      prioridade: "secundaria",
      lps: ["/plano-custom", "/vsl"],
      canais: ["meta_ads", "instagram_organico", "afiliados"],
      notas:
        "Volume bom mas decisão difusa. Diferenciar copy de Canva é crítico — Canva é o concorrente direto na cabeça dele.",
      ativo: true,
    },
    {
      produtoId,
      nome: "Social Media",
      cor: "#EC4899",
      descricao:
        "Profissional que cuida de feed de cliente(s) — terceirizado por agências ou autônomo.",
      demografia: "20-35 anos · Brasil · gerencia 2-8 contas",
      dor: "Feed diário, peças repetitivas (cards, frases, dicas), cronograma apertado.",
      desejo:
        "Gerar variações de carrossel e cards rapidamente, mantendo identidade do cliente.",
      objecoes: [
        "Identidade do cliente vai se perder",
        "Cliente pode notar que é IA",
        "Falta controle granular",
      ],
      mensagemChave: "Alimente o feed do seu cliente todo dia. Sem refrigerar criativo.",
      volumeMensal: "alto",
      wtpEstimado: "medio",
      churnRisk: "medio",
      pctPublicoAtual: 10,
      prioridade: "terciaria",
      lps: [],
      canais: ["instagram_organico", "comunidade_social_media"],
      notas:
        "Persona próxima do designer freelancer mas mais focada em volume. Possível LP dedicada futura.",
      ativo: true,
    },
    {
      produtoId,
      nome: "Criador de Conteúdo",
      cor: "#7D2AE8",
      descricao:
        "Criador no IG/TikTok/YouTube que precisa de capa, carrossel, thumb diariamente.",
      demografia: "18-35 anos · Brasil · 10k-500k seguidores",
      dor: "Criativo é o que decide alcance. Capa boa = vídeo viraliza. Mas criar capa demora.",
      desejo:
        "Capas e carrosséis de alto impacto em escala, no estilo dele.",
      objecoes: [
        "IA não vai entender meu estilo",
        "Já tenho editor próprio",
      ],
      mensagemChave:
        "Carrossel diário com identidade própria. Sem template genérico.",
      volumeMensal: "alto",
      wtpEstimado: "medio",
      churnRisk: "alto",
      pctPublicoAtual: 7,
      prioridade: "terciaria",
      lps: ["/captura-carrossel"],
      canais: ["instagram_organico", "tiktok"],
      notas:
        "% baixo hoje. Pode crescer se afiar mensagem. Captura via /captura-carrossel.",
      ativo: true,
    },
  ];

  let inserted = 0;
  let skipped = 0;
  for (const p of seedData) {
    const where = produtoId != null
      ? and(eq(personas.nome, p.nome), eq(personas.produtoId, produtoId))
      : eq(personas.nome, p.nome);
    const existing = await db.select().from(personas).where(where);
    if (existing.length > 0) {
      console.log(`[seed-personas] skip "${p.nome}" (já existe)`);
      skipped++;
      continue;
    }
    await db.insert(personas).values(p);
    console.log(`[seed-personas] +"${p.nome}"`);
    inserted++;
  }

  console.log(
    `[seed-personas] ✅ ${inserted} inserida(s), ${skipped} pulada(s).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-personas] ❌", err);
  process.exit(1);
});
