import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
loadEnv();
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "", { max: 1 });

const updated = await sql`
  UPDATE angulos
  SET lp_url = 'https://gravyx.com.br/emp-v1', atualizado_em = NOW()
  WHERE nome = 'Escala' AND persona_id = (
    SELECT id FROM personas WHERE nome ILIKE 'Dono de Ag%ncia' LIMIT 1
  )
  RETURNING nome, lp_url
`;
for (const r of updated) console.log(`✅ "${r.nome}" → ${r.lp_url}`);
await sql.end();
