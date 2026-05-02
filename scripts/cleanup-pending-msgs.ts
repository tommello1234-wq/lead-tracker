/**
 * Limpa mensagens pendentes pra leads que já pagaram (cliente_ativo, etc).
 * Caso de uso: webhook de carrinho_abandonado chegou retroativo, agendou
 * mensagens, mas cliente já tinha pago. Mensagens pendentes ficam órfãs.
 */
import { db } from "../db/client";
import { sql } from "drizzle-orm";

async function main() {
  // 1. Quantas tem hoje
  const before = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
    from mensagens_agendadas m
    join leads l on l.id = m.lead_id
    where m.status = 'pending'
      and l.status in ('cliente_ativo', 'cliente_em_risco', 'cliente_cancelado')
  `);
  const n = (before as unknown as Array<{ n: number }>)[0].n;
  console.log(`Mensagens pendentes pra leads pós-pagamento: ${n}`);

  if (n === 0) {
    console.log("Nada pra limpar.");
    process.exit(0);
  }

  // 2. Skip todas
  const result = await db.execute<{ id: number }>(sql`
    update mensagens_agendadas m
    set status = 'skipped',
        erro = 'Limpeza: lead já pós-pagamento quando agendamento foi feito'
    from leads l
    where m.lead_id = l.id
      and m.status = 'pending'
      and l.status in ('cliente_ativo', 'cliente_em_risco', 'cliente_cancelado')
    returning m.id
  `);
  const updated = (result as unknown as Array<{ id: number }>).length;
  console.log(`✓ ${updated} mensagens canceladas (status='skipped')`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
