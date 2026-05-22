import "dotenv/config";
import { db } from "./client";
import { messageTemplates, flowSteps, type MessageTemplate } from "./schema";
import { sql } from "drizzle-orm";

type TemplateSeed = {
  key: MessageTemplate;
  nome: string;
  descricao: string;
  conteudo: string;
  placeholders: string[];
};

const TEMPLATES: TemplateSeed[] = [
  {
    key: "boas_vindas_compra",
    nome: "Boas-vindas (compra aprovada)",
    descricao: "Quando uma compra é aprovada — primeira mensagem ao novo cliente.",
    conteudo: `Oi {{primeiroNome}}! 👋

Sua compra foi confirmada com sucesso ✅

Vou te mandar agora o passo a passo para comecar:

1️⃣ ...
2️⃣ ...
3️⃣ ...

Qualquer duvida, e so responder aqui mesmo. Estamos juntos!`,
    placeholders: ["primeiroNome", "nome", "valor"],
  },
  {
    key: "pix_nao_pago",
    nome: "PIX não pago (lembrete)",
    descricao: "Cliente gerou o PIX da primeira compra mas não finalizou. Lembrete amigável.",
    conteudo: `Oi {{primeiroNome}}, tudo bem?

Vi por aqui que voce gerou o PIX da sua compra mas ainda nao finalizou.

Aconteceu algo? Posso te ajudar com alguma coisa? Estou por aqui caso precise de uma maozinha 🤝`,
    placeholders: ["primeiroNome", "nome", "valor", "link_pix", "link_checkout"],
  },
  {
    key: "carrinho_abandonado",
    nome: "Carrinho abandonado",
    descricao: "Cliente começou a compra mas saiu sem terminar.",
    conteudo: `Oi {{primeiroNome}}!

Notei que voce comecou uma compra mas nao chegou a finalizar.

Tem alguma duvida sobre o produto que eu possa esclarecer? Posso te ajudar a fechar agora mesmo se quiser 😉`,
    placeholders: ["primeiroNome", "nome", "valor", "link_checkout"],
  },
  {
    key: "follow_up_indeciso",
    nome: "Follow-up indeciso",
    descricao: "Disparado manualmente quando cliente disse que ia comprar e não finalizou.",
    conteudo: `Oi {{primeiroNome}}, voltei aqui!

Voce me disse que ia comprar mas acabou nao concluindo. Posso te ajudar com alguma duvida ou objecao?

As vezes uma conversa rapida resolve tudo 😊`,
    placeholders: ["primeiroNome", "nome"],
  },
  {
    key: "reembolso_pre_cancelamento",
    nome: "Pré-cancelamento (reembolso solicitado)",
    descricao: "Antes de processar reembolso — tentativa amigável de entender o motivo.",
    conteudo: `Oi {{primeiroNome}}, vi sua solicitacao de reembolso aqui.

Antes de processar, posso te perguntar: qual foi o problema? Quero entender se tem algo que eu possa ajustar pra voce continuar.

As vezes a gente consegue resolver de outra forma — trocar de plano, ajustar acesso, etc.`,
    placeholders: ["primeiroNome", "nome"],
  },
  {
    key: "assinatura_pix_pendente",
    nome: "Assinatura: Renovação não paga",
    // Key mantida por compat com schema/flow_steps existentes — mas texto é
    // genérico (cobre Ticto/PIX, Stripe/cartão, Asaas/qualquer método).
    descricao: "Cliente assinante cuja renovação automática falhou (qualquer método).",
    conteudo: `Opa {{primeiroNome}}, tudo bem?

Vi aqui que a renovação automática do seu Gravyx não passou hoje. Pode ter sido qualquer coisa — saldo, limite do cartão, banco com lentidão...

Se quiser regularizar, é só clicar aqui: {{change_card_url}}

Qualquer coisa, é só responder aqui que te ajudo! 🙏`,
    placeholders: ["primeiroNome", "nome", "valor", "change_card_url", "hosted_invoice_url"],
  },
  {
    key: "compra_recusada",
    nome: "Compra recusada (cartão)",
    descricao:
      "Cliente NOVO tentou comprar mas o cartão foi recusado — tenta de novo + oferece outro método.",
    conteudo: `Opa {{primeiroNome}}, tudo bem?

Vi aqui que sua compra do plano {{plano}} ({{valor}}) não passou. O cartão pode ter sido recusado por algum motivo — sem limite, banco bloqueando, dado errado...

Se preferir pagar com PIX ou outro método, é só responder aqui que eu te mando o link! 🙏`,
    placeholders: ["primeiroNome", "nome", "plano", "valor", "change_card_url"],
  },
  {
    key: "custom",
    nome: "Custom (uso interno)",
    descricao: "Template livre — usado quando o conteúdo é passado direto via extras.",
    conteudo: `{{conteudo}}`,
    placeholders: ["conteudo"],
  },
];

type FlowSeed = {
  gatewayEvent: string;
  steps: Array<{
    ordem: number;
    templateKey: MessageTemplate;
    delaySeconds: number;
    cancelPrevious?: boolean;
  }>;
};

const FLOWS: FlowSeed[] = [
  {
    gatewayEvent: "compra_aprovada",
    steps: [
      { ordem: 1, templateKey: "boas_vindas_compra", delaySeconds: 30, cancelPrevious: true },
    ],
  },
  {
    gatewayEvent: "pix_gerado",
    steps: [
      { ordem: 1, templateKey: "pix_nao_pago", delaySeconds: 60 * 60 }, // 1h
      { ordem: 2, templateKey: "pix_nao_pago", delaySeconds: 60 * 60 * 24 }, // 24h
    ],
  },
  {
    gatewayEvent: "carrinho_abandonado",
    steps: [
      { ordem: 1, templateKey: "carrinho_abandonado", delaySeconds: 60 * 30 }, // 30min
    ],
  },
  {
    gatewayEvent: "reembolso",
    steps: [
      { ordem: 1, templateKey: "reembolso_pre_cancelamento", delaySeconds: 60 }, // 1min
    ],
  },
  {
    gatewayEvent: "assinatura_atrasada",
    steps: [
      { ordem: 1, templateKey: "assinatura_pix_pendente", delaySeconds: 0 }, // imediato
      { ordem: 2, templateKey: "assinatura_pix_pendente", delaySeconds: 60 * 60 * 24 }, // +24h
      { ordem: 3, templateKey: "assinatura_pix_pendente", delaySeconds: 60 * 60 * 48 }, // +48h
    ],
  },
  {
    gatewayEvent: "compra_recusada",
    steps: [
      // Lead novo, cartão recusado — tenta de novo logo (5min) pra pegar enquanto
      // ele ainda tá tentando comprar. Sem retry agressivo: 1 msg só, sem spam.
      { ordem: 1, templateKey: "compra_recusada", delaySeconds: 60 * 5 },
    ],
  },
];

async function main() {
  console.log("Inserindo templates (idempotente)...");
  for (const t of TEMPLATES) {
    await db
      .insert(messageTemplates)
      .values({
        key: t.key,
        nome: t.nome,
        descricao: t.descricao,
        conteudo: t.conteudo,
        conteudoDefault: t.conteudo,
        placeholdersDisponiveis: t.placeholders,
      })
      .onConflictDoUpdate({
        target: messageTemplates.key,
        set: {
          nome: t.nome,
          descricao: t.descricao,
          conteudoDefault: t.conteudo,
          placeholdersDisponiveis: t.placeholders,
          // NÃO sobrescreve `conteudo` — preserva edições do user
        },
      });
  }

  console.log("Inserindo flow steps (replace por gatewayEvent)...");
  for (const f of FLOWS) {
    // Mantém comportamento idempotente: se já existe step pra (event, ordem), atualiza.
    for (const s of f.steps) {
      // unique compound não foi declarado; deletamos e re-inserimos esse passo
      await db.execute(sql`
        DELETE FROM flow_steps
        WHERE gateway_event = ${f.gatewayEvent} AND ordem = ${s.ordem}
      `);
      await db.insert(flowSteps).values({
        gatewayEvent: f.gatewayEvent,
        ordem: s.ordem,
        templateKey: s.templateKey,
        delaySeconds: s.delaySeconds,
        cancelPrevious: s.cancelPrevious ?? false,
        ativo: true,
      });
    }
  }

  const tCount = await db.select({ count: sql<number>`count(*)::int` }).from(messageTemplates);
  const fCount = await db.select({ count: sql<number>`count(*)::int` }).from(flowSteps);
  console.log(
    `OK — ${tCount[0]?.count ?? 0} templates, ${fCount[0]?.count ?? 0} flow steps`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
