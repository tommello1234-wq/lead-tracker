import { db } from "../../db/client.js";
import { messageTemplates, type Lead, type MessageTemplate } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export type TemplateContext = {
  lead: Pick<Lead, "nome" | "valorEstimado" | "planoNome" | "valorAssinatura">;
  /** valores extras opcionais que webhooks podem injetar (link de pagamento, etc) */
  extras?: Record<string, string | number | undefined>;
};

function firstName(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

/** Limpa o nome do plano pra ficar bom em msgs WhatsApp.
 *  Ex: "Gravyx Creator (Pix)" -> "Creator"
 *      "1 × Gravyx Premium (at R$ 197.00 / month)" -> "Premium" */
function cleanPlanoNome(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/^\d+\s*[×x]\s*/i, "") // tira "1 × " do começo
    .replace(/\(at\s+R\$[^)]+\)/gi, "") // tira "(at R$ 67 / month)"
    .replace(/\(Pix\)/gi, "") // tira sufixo "(Pix)"
    .replace(/\bGravyx\b/gi, "") // tira "Gravyx" repetitivo
    .replace(/\s+/g, " ")
    .trim();
}

function applyReplacements(raw: string, ctx: TemplateContext): string {
  const planoLimpo = cleanPlanoNome(ctx.lead.planoNome);
  // "valor" prefere valorAssinatura (cobrança recorrente) e cai pra
  // valorEstimado (1ª compra) se necessário.
  const valorRaw = ctx.lead.valorAssinatura ?? ctx.lead.valorEstimado;
  const replacements: Record<string, string> = {
    nome: ctx.lead.nome,
    primeiroNome: firstName(ctx.lead.nome),
    valor:
      valorRaw != null
        ? valorRaw.toLocaleString("pt-BR", {
            style: "currency",
            currency: "BRL",
          })
        : "",
    plano: planoLimpo,
    planoNome: planoLimpo, // alias pra compatibilidade
    ...Object.fromEntries(
      Object.entries(ctx.extras ?? {}).map(([k, v]) => [k, String(v ?? "")]),
    ),
  };

  return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => replacements[key] ?? "");
}

/**
 * Carrega o conteúdo do template do banco e aplica os placeholders.
 * Templates são editáveis pelo dashboard em /automacoes.
 *
 * Se o template não existir no banco (caso muito raro de bug em seed),
 * retorna string vazia — o caller decide o que fazer (geralmente skip).
 */
export async function renderTemplate(
  template: MessageTemplate,
  ctx: TemplateContext,
): Promise<string> {
  const row = await db.query.messageTemplates.findFirst({
    where: eq(messageTemplates.key, template),
  });
  if (!row) return "";
  return applyReplacements(row.conteudo, ctx);
}
