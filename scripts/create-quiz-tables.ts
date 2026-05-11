/**
 * Cria as tabelas quiz_sessions + quiz_answers via SQL direto.
 *
 * - quiz_sessions: 1 linha por visitante anônimo (uuid client-side)
 * - quiz_answers: 1 linha por step respondido (FK cascade)
 *
 * Idempotente — usa IF NOT EXISTS.
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
    CREATE TABLE IF NOT EXISTS quiz_sessions (
      id TEXT PRIMARY KEY,
      persona TEXT,
      angulo TEXT,
      lp_url TEXT,
      utm_source TEXT,
      utm_campaign TEXT,
      utm_medium TEXT,
      utm_content TEXT,
      utm_term TEXT,
      lead_score INTEGER,
      email TEXT,
      user_agent TEXT,
      ip TEXT,
      started_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      atualizado_em TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ Tabela quiz_sessions criada (ou já existia)");

  await sql`
    CREATE TABLE IF NOT EXISTS quiz_answers (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
      step INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      answered_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  console.log("✅ Tabela quiz_answers criada (ou já existia)");

  // Index pra agregar funnel rápido por LP
  await sql`CREATE INDEX IF NOT EXISTS quiz_sessions_lp_url_idx ON quiz_sessions(lp_url)`;
  await sql`CREATE INDEX IF NOT EXISTS quiz_answers_session_step_idx ON quiz_answers(session_id, step)`;
  console.log("✅ Indexes criados");

  await sql.end();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
