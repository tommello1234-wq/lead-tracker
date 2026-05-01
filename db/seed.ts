import "dotenv/config";
import { db } from "./client";
import { leads, mensagensAgendadas, eventos } from "./schema";

const NOMES = [
  "Ana Silva", "Bruno Costa", "Carla Mendes", "Diego Rocha", "Eduarda Lima",
  "Felipe Santos", "Gabriela Almeida", "Henrique Souza", "Isabela Castro",
  "Joao Pereira", "Larissa Ferreira", "Marcos Oliveira", "Natalia Moraes",
  "Otavio Ribeiro", "Paula Cardoso", "Rafael Dias", "Sofia Barbosa",
  "Thiago Martins", "Vanessa Cunha", "Wagner Pinto", "Bianca Faria",
  "Cesar Lopes", "Daniela Nunes", "Erick Borges", "Fernanda Rios",
];

function rand<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInRange(daysBack: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
  d.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
  return d;
}

function fakePhone(i: number) {
  return `+55119${String(80000000 + i * 731).padStart(8, "0")}`;
}

async function main() {
  console.log("Limpando tabelas...");
  await db.delete(mensagensAgendadas);
  await db.delete(eventos);
  await db.delete(leads);

  console.log("Inserindo leads de exemplo (assinatura R$ 50)...");

  const distribuicao = [
    { count: 8, status: "cliente_ativo", subscription: "ativa", paid: true, pix: true, abandoned: false },
    { count: 5, status: "pix_gerado", subscription: "aguardando_pagamento", paid: false, pix: true, abandoned: false },
    { count: 4, status: "pix_expirado", subscription: "nenhuma", paid: false, pix: true, abandoned: false },
    { count: 3, status: "carrinho_abandonado", subscription: "nenhuma", paid: false, pix: false, abandoned: true },
    { count: 2, status: "cliente_em_risco", subscription: "ativa", paid: true, pix: true, abandoned: false },
    { count: 2, status: "cliente_cancelado", subscription: "cancelada", paid: true, pix: true, abandoned: false },
    { count: 1, status: "lead_novo", subscription: "nenhuma", paid: false, pix: false, abandoned: false },
  ] as const;

  let idx = 0;
  const rows = distribuicao.flatMap((bucket) =>
    Array.from({ length: bucket.count }).map(() => {
      const nome = NOMES[idx % NOMES.length];
      idx++;
      const criadoEm = randInRange(30);
      const pixGeradoEm = bucket.pix ? randInRange(20) : null;
      const pagouEm = bucket.paid ? randInRange(15) : null;
      const canceladoEm = bucket.status === "cliente_cancelado" ? randInRange(10) : null;

      return {
        nome,
        contato: fakePhone(idx),
        email: `${nome.toLowerCase().replace(/\s/g, ".")}@exemplo.com`,
        tipo: bucket.paid ? ("compra_aprovada" as const)
          : bucket.abandoned ? ("abandono_carrinho" as const)
          : bucket.pix ? ("pix_nao_pago" as const) : ("outro" as const),
        status: bucket.status,
        subscriptionStatus: bucket.subscription,
        origem: "site" as const,
        gateway: "ticto",
        gatewayCustomerId: `ticto_${idx}`,
        gatewayLastOrderId: `order_${idx}`,
        valorAssinatura: 50.0,
        valorEstimado: 50.0,
        planoNome: "Plano Mensal",
        criadoEm,
        atualizadoEm: criadoEm,
        pixGeradoEm,
        pagouEm,
        canceladoEm,
        primeiroContatoEm: bucket.paid ? randInRange(15) : null,
        respondeuEm: bucket.paid ? randInRange(15) : null,
        convertidoEm: pagouEm,
      };
    }),
  );

  await db.insert(leads).values(rows);
  console.log(`Inseridos ${rows.length} leads.`);

  // Algumas mensagens pendentes pra simular fila
  const pixGerados = await db.query.leads.findMany({
    where: (l, { eq }) => eq(l.status, "pix_gerado"),
  });

  const now = new Date();
  for (const lead of pixGerados.slice(0, 3)) {
    await db.insert(mensagensAgendadas).values({
      leadId: lead.id,
      template: "pix_nao_pago",
      conteudo: `Oi ${lead.nome.split(" ")[0]}, tudo bem? Vi que voce gerou o PIX mas nao finalizou...`,
      agendadoPara: new Date(now.getTime() - 60 * 1000),
      status: "pending",
    });
  }
  console.log("Algumas mensagens pendentes adicionadas.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
