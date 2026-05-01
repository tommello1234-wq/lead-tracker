import type { Lead, MessageTemplate } from "@/db/schema";

export type TemplateContext = {
  lead: Pick<Lead, "nome" | "valorEstimado">;
  /** valores extras opcionais que webhooks podem injetar (link de pagamento, etc) */
  extras?: Record<string, string | number | undefined>;
};

/**
 * Templates iniciais — voce pode editar livremente.
 * Use {{nome}}, {{valor}}, {{primeiroNome}}, ou qualquer chave de extras.
 */
export const TEMPLATES: Record<MessageTemplate, string> = {
  boas_vindas_compra: `Oi {{primeiroNome}}! 👋

Sua compra foi confirmada com sucesso ✅

Vou te mandar agora o passo a passo para comecar:

1️⃣ ...
2️⃣ ...
3️⃣ ...

Qualquer duvida, e so responder aqui mesmo. Estamos juntos!`,

  pix_nao_pago: `Oi {{primeiroNome}}, tudo bem?

Vi por aqui que voce gerou o PIX da sua compra mas ainda nao finalizou.

Aconteceu algo? Posso te ajudar com alguma coisa? Estou por aqui caso precise de uma maozinha 🤝`,

  carrinho_abandonado: `Oi {{primeiroNome}}!

Notei que voce comecou uma compra mas nao chegou a finalizar.

Tem alguma duvida sobre o produto que eu possa esclarecer? Posso te ajudar a fechar agora mesmo se quiser 😉`,

  follow_up_indeciso: `Oi {{primeiroNome}}, voltei aqui!

Voce me disse que ia comprar mas acabou nao concluindo. Posso te ajudar com alguma duvida ou objecao?

As vezes uma conversa rapida resolve tudo 😊`,

  reembolso_pre_cancelamento: `Oi {{primeiroNome}}, vi sua solicitacao de reembolso aqui.

Antes de processar, posso te perguntar: qual foi o problema? Quero entender se tem algo que eu possa ajustar pra voce continuar.

As vezes a gente consegue resolver de outra forma — trocar de plano, ajustar acesso, etc.`,

  custom: `{{conteudo}}`,
};

function firstName(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

export function renderTemplate(
  template: MessageTemplate,
  ctx: TemplateContext,
): string {
  const raw = TEMPLATES[template];
  const replacements: Record<string, string> = {
    nome: ctx.lead.nome,
    primeiroNome: firstName(ctx.lead.nome),
    valor:
      ctx.lead.valorEstimado != null
        ? ctx.lead.valorEstimado.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          })
        : "",
    ...Object.fromEntries(
      Object.entries(ctx.extras ?? {}).map(([k, v]) => [k, String(v ?? "")]),
    ),
  };

  return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? "");
}
