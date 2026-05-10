/**
 * Cadastra os 3 ângulos da persona Dono de Agência (Gargalo, Escala, Qualidade Invisível)
 * e marca os 3 ângulos antigos (vindos do import Meta) como 'perdedor'.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import postgres from "postgres";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
if (!url) {
  console.error("DATABASE_URL nao definida");
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

async function main() {
  // Acha persona Dono de Agência
  const personas = await sql`
    SELECT id, nome FROM personas WHERE nome ILIKE 'Dono de Ag%ncia' LIMIT 1
  `;
  if (personas.length === 0) {
    console.error("Persona 'Dono de Agência' não encontrada");
    process.exit(1);
  }
  const persona = personas[0];
  console.log(`✅ Persona: ${persona.nome} (id=${persona.id})`);

  // Marca todos ângulos atuais dessa persona como 'perdedor' (ROAS < 1)
  const oldAngulos = await sql`
    UPDATE angulos SET status = 'perdedor', atualizado_em = NOW()
    WHERE persona_id = ${persona.id} AND status != 'perdedor'
    RETURNING id, nome
  `;
  console.log(`📦 Marcados como perdedor: ${oldAngulos.length}`);
  for (const a of oldAngulos) console.log(`   - ${a.nome}`);

  // Acha produtoId de Gravyx
  const produtos = await sql`
    SELECT id FROM produtos WHERE LOWER(nome) LIKE '%gravyx%' LIMIT 1
  `;
  const produtoId = produtos[0]?.id ?? null;

  // Cadastra os 3 ângulos novos
  const novos = [
    {
      nome: "Gargalo",
      promessa: "Destrave o gargalo de criativo da sua agência.",
      hook: "Designer afogado, deadline batendo, cliente cobrando. Você sabe que criativo virou seu gargalo. Aqui é onde isso acaba.",
      cta: "Quero destravar minha agência",
    },
    {
      nome: "Escala",
      promessa: "Atenda 3x mais clientes sem contratar mais 1 designer.",
      hook: "Agência X saiu de 8 pra 24 clientes em 90 dias com a mesma equipe. Veja como.",
      cta: "Quero escalar minha agência",
    },
    {
      nome: "Qualidade Invisível",
      promessa: "Criativo que cliente não distingue de designer humano.",
      hook: "10 peças pro cliente: 5 do designer, 5 do Gravyx. Veja qual ele aprovou primeiro.",
      cta: "Quero ver os comparativos",
    },
  ];

  let inserted = 0;
  for (const a of novos) {
    // Skip se já existe com esse nome
    const existing = await sql`
      SELECT id FROM angulos WHERE persona_id = ${persona.id} AND nome = ${a.nome}
    `;
    if (existing.length > 0) {
      console.log(`⏭️  "${a.nome}" já existe, pulando`);
      continue;
    }
    await sql`
      INSERT INTO angulos (persona_id, produto_id, nome, promessa, hook, cta, status)
      VALUES (${persona.id}, ${produtoId}, ${a.nome}, ${a.promessa}, ${a.hook}, ${a.cta}, 'ideia')
    `;
    console.log(`+ "${a.nome}"`);
    inserted++;
  }

  console.log(`\n✅ ${inserted} ângulo(s) novo(s) cadastrado(s).`);
  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
