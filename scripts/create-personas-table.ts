/**
 * Cria a tabela personas via SQL direto. Mais confiável que db:push em ambiente
 * com prompts interativos.
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
  await sql`
    CREATE TABLE IF NOT EXISTS personas (
      id SERIAL PRIMARY KEY,
      produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      slug TEXT,
      cor TEXT,
      descricao TEXT,
      demografia TEXT,
      dor TEXT,
      desejo TEXT,
      objecoes JSONB NOT NULL DEFAULT '[]'::jsonb,
      mensagem_chave TEXT,
      volume_mensal TEXT,
      wtp_estimado TEXT,
      churn_risk TEXT,
      pct_publico_atual REAL,
      prioridade TEXT NOT NULL DEFAULT 'explorando',
      lps JSONB NOT NULL DEFAULT '[]'::jsonb,
      canais JSONB NOT NULL DEFAULT '[]'::jsonb,
      notas TEXT,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ Tabela personas criada (ou já existia)");
  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
