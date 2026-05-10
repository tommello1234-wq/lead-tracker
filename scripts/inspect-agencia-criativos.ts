import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "", { max: 1 });

const personas = await sql`SELECT id FROM personas WHERE nome ILIKE 'Dono de Ag%ncia' LIMIT 1`;
const personaId = personas[0]?.id;

const rows = await sql`
  SELECT c.id, c.headline_overlay, c.tipo, c.ctr, c.cpa, c.impressoes,
         c.meta_ads_id, c.angulo_id,
         a.nome as angulo_nome, a.status as angulo_status
  FROM criativos c
  JOIN angulos a ON a.id = c.angulo_id
  WHERE a.persona_id = ${personaId}
  ORDER BY c.criado_em
`;

console.log(`\n📦 ${rows.length} criativos vinculados a ângulos da Agência\n`);
for (const r of rows) {
  console.log(`#${r.id} [${r.tipo}] CTR=${r.ctr ?? "—"} CPA=${r.cpa ?? "—"} imp=${r.impressoes ?? "—"}`);
  console.log(`   ângulo atual: "${r.angulo_nome}" (${r.angulo_status})`);
  console.log(`   headline: "${r.headline_overlay ?? "(sem headline)"}"`);
  console.log(``);
}
await sql.end();
