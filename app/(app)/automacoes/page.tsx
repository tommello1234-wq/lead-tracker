import { db } from "@/db/client";
import { messageTemplates, flowSteps } from "@/db/schema";
import { asc } from "drizzle-orm";
import {
  TemplatesMasterDetail,
  type EventGroup,
  type EventOption,
  type MessageRow,
} from "./templates-master-detail";

export const dynamic = "force-dynamic";

const EVENT_META: Record<string, { nome: string; descricao: string; emoji: string }> = {
  compra_aprovada: {
    nome: "Compra aprovada",
    descricao: "Quando uma compra é confirmada (PIX/cartão pago).",
    emoji: "✅",
  },
  pix_gerado: {
    nome: "PIX gerado",
    descricao: "Cliente gerou o PIX da primeira compra mas ainda não pagou.",
    emoji: "⏳",
  },
  carrinho_abandonado: {
    nome: "Carrinho abandonado",
    descricao: "Cliente saiu do checkout sem terminar.",
    emoji: "🛒",
  },
  reembolso: {
    nome: "Reembolso solicitado",
    descricao: "Cliente pediu reembolso. Tentativa amigável antes de processar.",
    emoji: "↩️",
  },
  assinatura_atrasada: {
    nome: "Assinatura: PIX atrasado",
    descricao: "Cliente assinante com renovação automática falhada.",
    emoji: "⚠️",
  },
};

const ALL_EVENT_OPTIONS: EventOption[] = Object.entries(EVENT_META).map(([value, meta]) => ({
  value,
  label: `${meta.emoji} ${meta.nome}`,
  nome: meta.nome,
  descricao: meta.descricao,
  emoji: meta.emoji,
}));

export default async function AutomacoesPage() {
  const [templates, steps] = await Promise.all([
    db.select().from(messageTemplates).orderBy(asc(messageTemplates.id)),
    db
      .select()
      .from(flowSteps)
      .orderBy(asc(flowSteps.gatewayEvent), asc(flowSteps.ordem)),
  ]);

  const templateByKey = new Map(templates.map((t) => [t.key, t]));

  // Agrupa steps por gatewayEvent → cria EventGroup
  const stepsByEvent = new Map<string, typeof steps>();
  for (const s of steps) {
    const arr = stepsByEvent.get(s.gatewayEvent) ?? [];
    arr.push(s);
    stepsByEvent.set(s.gatewayEvent, arr);
  }

  const events: EventGroup[] = Array.from(stepsByEvent.entries()).map(
    ([eventKey, eventSteps]) => {
      const meta = EVENT_META[eventKey] ?? {
        nome: eventKey,
        descricao: "",
        emoji: "•",
      };
      const messages: MessageRow[] = eventSteps
        .sort((a, b) => a.ordem - b.ordem)
        .map((s) => {
          const tpl = templateByKey.get(s.templateKey);
          return {
            stepId: s.id,
            ordem: s.ordem,
            templateKey: s.templateKey,
            templateNome: tpl?.nome ?? s.templateKey,
            conteudo: tpl?.conteudo ?? "",
            conteudoDefault: tpl?.conteudoDefault ?? "",
            placeholders: tpl?.placeholdersDisponiveis ?? [],
            delaySeconds: s.delaySeconds,
            ativo: s.ativo,
            cancelPrevious: s.cancelPrevious,
          };
        });
      return {
        key: eventKey,
        nome: meta.nome,
        descricao: meta.descricao,
        emoji: meta.emoji,
        messages,
      };
    },
  );

  // Ordena eventos pela ordem da definição (compra_aprovada primeiro, etc.)
  const orderMap = new Map(Object.keys(EVENT_META).map((k, i) => [k, i]));
  events.sort(
    (a, b) =>
      (orderMap.get(a.key) ?? 999) - (orderMap.get(b.key) ?? 999),
  );

  const totalMensagens = events.reduce((acc, ev) => acc + ev.messages.length, 0);
  const editadas = events.reduce(
    (acc, ev) =>
      acc + ev.messages.filter((m) => m.conteudo !== m.conteudoDefault).length,
    0,
  );

  return (
    <div className="space-y-6">
      <section className="rounded-3xl bg-sidebar text-sidebar-foreground p-6 sm:p-8">
        <div className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Automações
            </h1>
            <p className="text-sidebar-foreground/70 text-sm mt-1 max-w-2xl">
              Cada evento dispara um fluxo de mensagens. Crie, edite ou apague —
              mudanças têm efeito imediato em eventos novos que chegarem.
            </p>
          </div>
          <div className="flex gap-2">
            <div className="px-3 py-2 rounded-xl bg-sidebar-accent text-center">
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
                Eventos
              </p>
              <p className="text-xl font-bold tabular-nums">{events.length}</p>
            </div>
            <div className="px-3 py-2 rounded-xl bg-sidebar-accent text-center">
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
                Mensagens
              </p>
              <p className="text-xl font-bold tabular-nums">{totalMensagens}</p>
            </div>
            <div className="px-3 py-2 rounded-xl bg-sidebar-accent text-center">
              <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60">
                Editadas
              </p>
              <p className="text-xl font-bold tabular-nums text-[oklch(0.86_0.22_130)]">
                {editadas}
              </p>
            </div>
          </div>
        </div>
      </section>

      <TemplatesMasterDetail events={events} allEventOptions={ALL_EVENT_OPTIONS} />
    </div>
  );
}
