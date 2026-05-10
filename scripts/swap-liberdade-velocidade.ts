import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();

import postgres from "postgres";

const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";
const sql = postgres(url, { max: 1 });

async function main() {
  const personas = await sql`SELECT id FROM personas WHERE nome ILIKE 'Dono de Ag%ncia' LIMIT 1`;
  const personaId = personas[0]?.id;
  if (!personaId) { console.error("persona not found"); process.exit(1); }

  const produtos = await sql`SELECT id FROM produtos WHERE LOWER(nome) LIKE '%gravyx%' LIMIT 1`;
  const produtoId = produtos[0]?.id ?? null;

  const deleted = await sql`
    DELETE FROM angulos
    WHERE persona_id = ${personaId} AND nome = 'Liberdade'
    RETURNING nome
  `;
  console.log(`🗑️  Deletados: ${deleted.map((d) => d.nome).join(", ") || "—"}`);

  const exists = await sql`
    SELECT id FROM angulos WHERE persona_id = ${personaId} AND nome = 'Velocidade'
  `;
  if (exists.length === 0) {
    await sql`
      INSERT INTO angulos (persona_id, produto_id, nome, promessa, hook, cta, status)
      VALUES (
        ${personaId},
        ${produtoId},
        'Velocidade',
        'Entregue antes do prazo. Sempre. Cliente vira fã.',
        'Cliente pediu última hora? Sua agência entrega antes do concorrente abrir o Photoshop. Sem horas extras, sem fim de semana queimado.',
        'Quero entregar antes do prazo',
        'ideia'
      )
    `;
    console.log(`+ "Velocidade"`);
  } else {
    console.log(`⏭️  Velocidade já existe`);
  }

  const final = await sql`
    SELECT nome, status FROM angulos
    WHERE persona_id = ${personaId} AND status != 'perdedor'
    ORDER BY criado_em
  `;
  console.log(`\n✅ Ângulos ativos da Agência: ${final.length}`);
  for (const a of final) console.log(`   - ${a.nome} (${a.status})`);

  await sql.end();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
