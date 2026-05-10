import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "", { max: 1 });

const personas = await sql`SELECT id FROM personas WHERE nome ILIKE 'Dono de Ag%ncia' LIMIT 1`;
const personaId = personas[0]?.id;

const rows = await sql`
  SELECT id, nome, status, lp_url FROM angulos
  WHERE persona_id = ${personaId}
  ORDER BY criado_em
`;
for (const r of rows) {
  console.log(`#${r.id} "${r.nome}" (${r.status})`);
  console.log(`   lpUrl: ${r.lp_url ?? "(null)"}`);
}
await sql.end();
