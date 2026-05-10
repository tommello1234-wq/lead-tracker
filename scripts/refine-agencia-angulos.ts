/**
 * Refina os ângulos da Agência seguindo o critério:
 *   ângulo = OUTCOME (resultado), criativo = motivo/argumento.
 *
 * - Delete "Gargalo" (era motivo, vira criativo dentro de Escala depois)
 * - Delete "Qualidade Invisível" (era objection-handler, vira criativo)
 * - Mantém "Escala"
 * - Adiciona "Margem" (outcome: mais lucro)
 * - Adiciona "Liberdade" (outcome: dono não-refém da equipe)
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
  const personas = await sql`
    SELECT id FROM personas WHERE nome ILIKE 'Dono de Ag%ncia' LIMIT 1
  `;
  const personaId = personas[0]?.id;
  if (!personaId) {
    console.error("Persona não encontrada");
    process.exit(1);
  }
  console.log(`✅ persona id=${personaId}`);

  // Deleta Gargalo + Qualidade Invisível (criados na rodada anterior)
  const deleted = await sql`
    DELETE FROM angulos
    WHERE persona_id = ${personaId}
      AND nome IN ('Gargalo', 'Qualidade Invisível')
    RETURNING nome
  `;
  console.log(`🗑️  Deletados: ${deleted.map((d) => d.nome).join(", ") || "—"}`);

  // Acha produtoId
  const produtos = await sql`
    SELECT id FROM produtos WHERE LOWER(nome) LIKE '%gravyx%' LIMIT 1
  `;
  const produtoId = produtos[0]?.id ?? null;

  // Adiciona Margem + Liberdade (skip se já existem)
  const novos = [
    {
      nome: "Margem",
      promessa: "Multiplique a margem da sua agência sem cortar entregas.",
      hook: "Designer pleno custa R$ 5.500/mês. Seu Gravyx custa R$ 67. Faça as contas — quanto sobra no fim do mês?",
      cta: "Quero recuperar minha margem",
    },
    {
      nome: "Liberdade",
      promessa: "Sua agência rodando sem você no comando 12h/dia.",
      hook: "Você abriu a agência pra ter liberdade. Hoje é refém do WhatsApp do designer. Aqui é onde isso acaba.",
      cta: "Quero retomar minha liberdade",
    },
  ];

  let inserted = 0;
  for (const a of novos) {
    const exists = await sql`
      SELECT id FROM angulos WHERE persona_id = ${personaId} AND nome = ${a.nome}
    `;
    if (exists.length > 0) {
      console.log(`⏭️  "${a.nome}" já existe, pulando`);
      continue;
    }
    await sql`
      INSERT INTO angulos (persona_id, produto_id, nome, promessa, hook, cta, status)
      VALUES (${personaId}, ${produtoId}, ${a.nome}, ${a.promessa}, ${a.hook}, ${a.cta}, 'ideia')
    `;
    console.log(`+ "${a.nome}"`);
    inserted++;
  }

  // Lista o estado final dos ângulos da Agência (status != perdedor)
  const final = await sql`
    SELECT nome, status FROM angulos
    WHERE persona_id = ${personaId} AND status != 'perdedor'
    ORDER BY criado_em
  `;
  console.log(`\n✅ Ângulos ativos na Agência: ${final.length}`);
  for (const a of final) console.log(`   - ${a.nome} (${a.status})`);

  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
