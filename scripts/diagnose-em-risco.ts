/**
 * Classifica os 22 "em risco" pra entender o que cada um realmente é.
 */
import { db } from "../db/client";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await db.execute<{
    id: number;
    nome: string;
    sub_status: string;
    total_eventos: number;
    ultimo_event: string | null;
    payload_status: string | null;
    successful_charges: number | null;
    payment_method: string | null;
  }>(sql`
    select
      l.id,
      l.nome,
      l.subscription_status as sub_status,
      coalesce((select count(*)::int from eventos where lead_id = l.id), 0) as total_eventos,
      (select event_type from eventos where lead_id = l.id order by received_at desc limit 1) as ultimo_event,
      (select payload->>'status' from eventos where lead_id = l.id order by received_at desc limit 1) as payload_status,
      (select (payload->'subscriptions'->0->>'successful_charges')::int from eventos where lead_id = l.id order by received_at desc limit 1) as successful_charges,
      (select payload->>'payment_method' from eventos where lead_id = l.id order by received_at desc limit 1) as payment_method
    from leads l
    where l.status = 'cliente_em_risco'
    order by l.id
  `);

  const rowsArr = rows as unknown as Array<{
    id: number;
    nome: string;
    sub_status: string;
    total_eventos: number;
    ultimo_event: string | null;
    payload_status: string | null;
    successful_charges: number | null;
    payment_method: string | null;
  }>;

  console.log("\n=== Diagnóstico ===\n");
  console.log("ID  | Nome                          | Sub status   | #ev | Último evento         | Ticto status              | charges | método");
  console.log("-".repeat(180));

  let cat1 = 0; // sem eventos = importado puro
  let cat2 = 0; // pix_recurring + successful_charges=0 = nunca pagou (deveria ser pix_pendente)
  let cat3 = 0; // reembolso real
  let cat4 = 0; // assinatura_atrasada genuína
  let cat5 = 0; // outro

  for (const r of rowsArr) {
    const id = String(r.id).padEnd(3);
    const nome = (r.nome ?? "-").substring(0, 28).padEnd(29);
    const sub = (r.sub_status ?? "-").padEnd(12);
    const ev = String(r.total_eventos).padStart(3);
    const ult = (r.ultimo_event ?? "(sem evento)").substring(0, 21).padEnd(21);
    const ps = (r.payload_status ?? "-").substring(0, 25).padEnd(25);
    const sc = String(r.successful_charges ?? "-").padStart(7);
    const pm = (r.payment_method ?? "-").padEnd(15);
    console.log(`${id} | ${nome} | ${sub} | ${ev} | ${ult} | ${ps} | ${sc} | ${pm}`);

    if (r.total_eventos === 0) cat1++;
    else if (r.payment_method === "pix_recurring" && (r.successful_charges ?? 0) === 0) cat2++;
    else if (r.sub_status === "reembolsada") cat3++;
    else if (r.payload_status === "subscription_delayed" && (r.successful_charges ?? 0) > 0) cat4++;
    else cat5++;
  }

  console.log(`\n=== Categorias ===`);
  console.log(`Importação pura (zero eventos):                            ${cat1}`);
  console.log(`PIX recorrente que NUNCA foi pago (status errado):         ${cat2}`);
  console.log(`Reembolso real:                                            ${cat3}`);
  console.log(`Assinatura atrasada GENUÍNA (pagou antes, falhou agora):   ${cat4}`);
  console.log(`Outros casos:                                              ${cat5}`);

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
