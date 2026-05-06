import { db } from "../db/client.js";
import { leads, produtos } from "../db/schema.js";
import { eq, and, sql } from "drizzle-orm";

async function main() {
  const todosProdutos = await db.select().from(produtos);
  console.log(`\n=== PRODUTOS ===`);
  for (const p of todosProdutos) {
    console.log(`  id=${p.id} nome=${p.nome}`);
  }

  const gravyx = todosProdutos.find((p) => p.nome.toLowerCase().includes("gravyx"));
  if (!gravyx) {
    console.log("Produto Gravyx não encontrado");
    process.exit(1);
  }

  // Distribuição por status SÓ Gravyx
  const dist = (await db.execute(sql`
    select subscription_status, count(*)::int as n,
           coalesce(sum(valor_assinatura), 0)::float as soma
    from leads
    where produto_id = ${gravyx.id}
    group by subscription_status
    order by n desc
  `)) as unknown as Array<{
    subscription_status: string | null;
    n: number;
    soma: number;
  }>;

  const ativosGravyx = await db
    .select()
    .from(leads)
    .where(and(eq(leads.subscriptionStatus, "ativa"), eq(leads.produtoId, gravyx.id)));

  const mrr = ativosGravyx.reduce((a, l) => a + (l.valorAssinatura ?? 0), 0);
  const arpu = ativosGravyx.length > 0 ? mrr / ativosGravyx.length : 0;

  console.log(`\n=== SNAPSHOT GRAVYX (id=${gravyx.id}) ===\n`);
  console.log(`Distribuição por status:`);
  for (const r of dist) {
    console.log(
      `  ${(r.subscription_status ?? "(null)").padEnd(25)} ${String(r.n).padStart(4)}  R$ ${r.soma.toFixed(2)}`,
    );
  }
  console.log(`\nClientes ATIVOS Gravyx: ${ativosGravyx.length}`);
  console.log(`MRR Gravyx: R$ ${mrr.toFixed(2)}`);
  console.log(`ARPU: R$ ${arpu.toFixed(2)}`);

  // Distribuição de planos entre ativos
  console.log(`\n=== PLANOS ENTRE ATIVOS GRAVYX ===`);
  const buckets = (await db.execute(sql`
    select plano_nome, valor_assinatura::float as valor, count(*)::int as n
    from leads
    where subscription_status = 'ativa' and produto_id = ${gravyx.id}
    group by plano_nome, valor_assinatura
    order by n desc, valor desc nulls last
  `)) as unknown as Array<{
    plano_nome: string | null;
    valor: number | null;
    n: number;
  }>;
  for (const b of buckets) {
    console.log(
      `  R$ ${(b.valor ?? 0).toFixed(2).padStart(8)} x${String(b.n).padStart(4)}  ${b.plano_nome ?? "(null)"}`,
    );
  }

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
