import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "", { max: 1 });

const personas = await sql`SELECT id FROM personas WHERE nome ILIKE 'Dono de Ag%ncia' LIMIT 1`;
const personaId = personas[0]?.id;

const escala = await sql`
  SELECT id FROM angulos WHERE persona_id = ${personaId} AND nome = 'Escala' LIMIT 1
`;
const escalaId = escala[0]?.id;
if (!escalaId) { console.error("Escala não encontrada"); process.exit(1); }

// Move #4 e #15 pra Escala (match com volume)
const moved = await sql`
  UPDATE criativos SET angulo_id = ${escalaId}, status = 'pausado', atualizado_em = NOW()
  WHERE id IN (4, 15)
  RETURNING id, headline_overlay
`;
console.log(`✅ Movidos pra Escala (status=pausado):`);
for (const c of moved) console.log(`   #${c.id}: "${c.headline_overlay}"`);

// #7 fica onde está (perdedor) — não cabe nos novos ângulos
console.log(`\n⏸️  #7 ("Assine agora e teste por 7 dias grátis") mantido no perdedor — é oferta, não ângulo`);

// Mostra estado final
const final = await sql`
  SELECT a.nome as angulo, a.status as a_status,
         COUNT(c.id) as n_criativos,
         COALESCE(json_agg(c.headline_overlay) FILTER (WHERE c.id IS NOT NULL), '[]') as headlines
  FROM angulos a
  LEFT JOIN criativos c ON c.angulo_id = a.id
  WHERE a.persona_id = ${personaId}
  GROUP BY a.id, a.nome, a.status, a.criado_em
  ORDER BY a.criado_em
`;
console.log(`\n📊 Estado final dos ângulos da Agência:`);
for (const r of final) {
  console.log(`\n   "${r.angulo}" (${r.a_status}) — ${r.n_criativos} criativo(s)`);
  for (const h of r.headlines) {
    if (h) console.log(`      • ${h}`);
  }
}

await sql.end();
