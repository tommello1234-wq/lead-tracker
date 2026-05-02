import { db } from "../../db/client";
import { messageTemplates, type Lead, type MessageTemplate } from "../../db/schema";
import { eq } from "drizzle-orm";

export type TemplateContext = {
  lead: Pick<Lead, "nome" | "valorEstimado">;
  /** valores extras opcionais que webhooks podem injetar (link de pagamento, etc) */
  extras?: Record<string, string | number | undefined>;
};

function firstName(nome: string): string {
  return nome.trim().split(/\s+/)[0] ?? nome;
}

function applyReplacements(raw: string, ctx: TemplateContext): string {
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
