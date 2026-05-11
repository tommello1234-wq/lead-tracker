/**
 * Atualiza lp_url de criativos e ângulos no DB pra refletir o
 * novo padrão de slug /{persona}-{angulo}-{versao}[-byok]-{formato}.
 *
 * Renames aplicados em GRAVYX LP V2:
 *   /emp-v1        → /agencia-velocidade-v1-long
 *   /designer      → /designer-controle-v1-long
 *   /plano-custom  → /agencia-escala-v1-byok-long
 *   /vsl           → /agencia-escala-v1-byok-vsl
 *
 * O vercel.json mantém redirect 301 pros slugs antigos, então ads
 * históricos continuam funcionando. Mesmo assim, atualizamos o DB
 * pra consistência (mind map mostra o slug correto).
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

const RENAMES: Array<{ old: string; new: string }> = [
  { old: "/emp-v1", new: "/agencia-velocidade-v1-long" },
  { old: "/designer", new: "/designer-controle-v1-long" },
  { old: "/plano-custom", new: "/agencia-escala-v1-byok-long" },
  { old: "/vsl", new: "/agencia-escala-v1-byok-vsl" },
];

const sql = postgres(url, { max: 1 });

async function main() {
  for (const { old: oldSlug, new: newSlug } of RENAMES) {
    console.log(`\n=== Migrando ${oldSlug} → ${newSlug} ===`);

    // Criativos: substituir o path
    const criativos = await sql<Array<{ id: number; lp_url: string }>>`
      UPDATE criativos
      SET lp_url = REGEXP_REPLACE(lp_url, ${"^(.*?)" + escapeRegex(oldSlug) + "(/.*)?$"}, ${"\\1" + newSlug + "\\2"}),
          atualizado_em = NOW()
      WHERE lp_url ~ ${"(^|/)" + escapeRegex(oldSlug.slice(1)) + "(/|$)"}
      RETURNING id, lp_url
    `;
    console.log(`  Criativos atualizados: ${criativos.length}`);
    for (const c of criativos) console.log(`    #${c.id} → ${c.lp_url}`);

    // Ângulos: mesma coisa
    const angulos = await sql<Array<{ id: number; nome: string; lp_url: string }>>`
      UPDATE angulos
      SET lp_url = REGEXP_REPLACE(lp_url, ${"^(.*?)" + escapeRegex(oldSlug) + "(/.*)?$"}, ${"\\1" + newSlug + "\\2"}),
          atualizado_em = NOW()
      WHERE lp_url ~ ${"(^|/)" + escapeRegex(oldSlug.slice(1)) + "(/|$)"}
      RETURNING id, nome, lp_url
    `;
    console.log(`  Ângulos atualizados: ${angulos.length}`);
    for (const a of angulos) console.log(`    #${a.id} "${a.nome}" → ${a.lp_url}`);
  }

  await sql.end();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
