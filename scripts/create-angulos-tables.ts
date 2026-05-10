/**
 * Cria as tabelas angulos + criativos via SQL direto.
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
    CREATE TABLE IF NOT EXISTS angulos (
      id SERIAL PRIMARY KEY,
      persona_id INTEGER REFERENCES personas(id) ON DELETE CASCADE,
      produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      promessa TEXT,
      hook TEXT,
      cta TEXT,
      status TEXT NOT NULL DEFAULT 'ideia',
      lp_url TEXT,
      lp_screenshot TEXT,
      ctr REAL,
      cpa REAL,
      roas REAL,
      dias_rodando INTEGER,
      budget_mensal REAL,
      notas TEXT,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ Tabela angulos criada (ou já existia)");

  await sql`
    CREATE TABLE IF NOT EXISTS criativos (
      id SERIAL PRIMARY KEY,
      angulo_id INTEGER REFERENCES angulos(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL DEFAULT 'imagem',
      url TEXT,
      thumb_url TEXT,
      headline_overlay TEXT,
      meta_ads_id TEXT,
      status TEXT NOT NULL DEFAULT 'ativo',
      ctr REAL,
      cpa REAL,
      impressoes INTEGER,
      notas TEXT,
      criado_em TIMESTAMP NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ Tabela criativos criada (ou já existia)");

  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
