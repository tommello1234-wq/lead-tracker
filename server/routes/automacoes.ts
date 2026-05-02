import { Hono } from "hono";
import { z } from "zod";
import { db } from "@db/client";
import {
  messageTemplates,
  flowSteps,
  type MessageTemplate,
} from "@db/schema";
import { eq, asc } from "drizzle-orm";

export const automacoesRoutes = new Hono();

const DELAY_UNITS: Record<string, number> = {
  seconds: 1,
  minutes: 60,
  hours: 60 * 60,
  days: 60 * 60 * 24,
};

function delayToSeconds(value: number, unit: string): number {
  const multiplier = DELAY_UNITS[unit];
  if (!multiplier) throw new Error("Unidade inválida");
  if (!Number.isFinite(value) || value < 0) throw new Error("Delay inválido");
  const s = Math.floor(value * multiplier);
  if (s > 60 * 60 * 24 * 30) throw new Error("Delay máximo: 30 dias");
  return s;
}

function slugify(s: string, max = 40): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, max);
}

/* ==========================================================================
 * GET /api/automacoes/templates
 * Lista todos os templates + flow_steps relacionados.
 * ========================================================================== */
automacoesRoutes.get("/templates", async (c) => {
  const [templates, steps] = await Promise.all([
    db.select().from(messageTemplates).orderBy(asc(messageTemplates.nome)),
    db.select().from(flowSteps).orderBy(asc(flowSteps.gatewayEvent), asc(flowSteps.ordem)),
  ]);
  return c.json({ templates, flowSteps: steps });
});

/* ==========================================================================
 * POST /api/automacoes/templates  (create new template)
 * ========================================================================== */
const createTemplateSchema = z.object({
  nome: z.string().min(1),
  descricao: z.string().nullable().optional(),
  conteudo: z.string().min(1).max(4000),
  gatewayEvent: z.string().optional(),
});
automacoesRoutes.post("/templates", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);
  }
  const { nome, descricao, conteudo, gatewayEvent } = parsed.data;

  const key = slugify(nome);
  if (!key) return c.json({ error: "Não foi possível gerar key" }, 400);

  const existing = await db.query.messageTemplates.findFirst({
    where: eq(messageTemplates.key, key as never),
  });
  if (existing) return c.json({ error: `Já existe template com key "${key}"` }, 409);

  await db.insert(messageTemplates).values({
    key: key as never,
    nome,
    descricao: descricao ?? null,
    conteudo,
    conteudoDefault: conteudo,
    placeholdersDisponiveis: ["primeiroNome", "nome", "valor"],
  });

  if (gatewayEvent) {
    const existingSteps = await db
      .select()
      .from(flowSteps)
      .where(eq(flowSteps.gatewayEvent, gatewayEvent));
    const maxOrdem = existingSteps.reduce((m, s) => (s.ordem > m ? s.ordem : m), 0);
    await db.insert(flowSteps).values({
      gatewayEvent,
      ordem: maxOrdem + 1,
      templateKey: key as never,
      delaySeconds: 60 * 60,
      ativo: false,
      cancelPrevious: false,
    });
  }

  return c.json({ ok: true, key });
});

/* ==========================================================================
 * PATCH /api/automacoes/templates/:key  (update conteudo)
 * ========================================================================== */
automacoesRoutes.patch("/templates/:key", async (c) => {
  const key = c.req.param("key") as MessageTemplate;
  const body = await c.req.json().catch(() => ({}));
  const conteudo = String(body?.conteudo ?? "").trim();
  if (!conteudo) return c.json({ error: "Conteúdo obrigatório" }, 400);
  if (conteudo.length > 4000) return c.json({ error: "Conteúdo muito longo" }, 400);

  await db
    .update(messageTemplates)
    .set({ conteudo, atualizadoEm: new Date() })
    .where(eq(messageTemplates.key, key));
  return c.json({ ok: true });
});

/* ==========================================================================
 * POST /api/automacoes/templates/:key/revert
 * ========================================================================== */
automacoesRoutes.post("/templates/:key/revert", async (c) => {
  const key = c.req.param("key") as MessageTemplate;
  const tpl = await db.query.messageTemplates.findFirst({
    where: eq(messageTemplates.key, key),
  });
  if (!tpl) return c.json({ error: `Template ${key} não encontrado` }, 404);

  await db
    .update(messageTemplates)
    .set({ conteudo: tpl.conteudoDefault, atualizadoEm: new Date() })
    .where(eq(messageTemplates.key, key));
  return c.json({ ok: true });
});

/* ==========================================================================
 * DELETE /api/automacoes/templates/:key
 * ========================================================================== */
automacoesRoutes.delete("/templates/:key", async (c) => {
  const key = c.req.param("key");
  const inUse = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.templateKey, key as never));
  if (inUse.length > 0) {
    return c.json(
      { error: `Não dá pra apagar — template está em ${inUse.length} passo(s).` },
      409,
    );
  }
  await db.delete(messageTemplates).where(eq(messageTemplates.key, key as never));
  return c.json({ ok: true });
});

/* ==========================================================================
 * POST /api/automacoes/flow-steps  (add new step)
 * ========================================================================== */
const addStepSchema = z.object({
  templateKey: z.string().min(1),
  gatewayEvent: z.string().min(1),
  delayValue: z.number(),
  delayUnit: z.string().default("hours"),
});
automacoesRoutes.post("/flow-steps", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = addStepSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);
  }
  const { templateKey, gatewayEvent, delayValue, delayUnit } = parsed.data;

  let delaySeconds: number;
  try {
    delaySeconds = delayToSeconds(delayValue, delayUnit);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Delay inválido" }, 400);
  }

  const existing = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.gatewayEvent, gatewayEvent));
  if (existing.length >= 5) {
    return c.json({ error: "Máximo de 5 passos por fluxo" }, 409);
  }
  const maxOrdem = existing.reduce((m, s) => (s.ordem > m ? s.ordem : m), 0);

  await db.insert(flowSteps).values({
    gatewayEvent,
    ordem: maxOrdem + 1,
    templateKey: templateKey as never,
    delaySeconds,
    ativo: true,
    cancelPrevious: false,
  });

  return c.json({ ok: true });
});

/* ==========================================================================
 * PATCH /api/automacoes/flow-steps/:id
 * ========================================================================== */
automacoesRoutes.patch("/flow-steps/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID inválido" }, 400);
  const body = await c.req.json().catch(() => ({}));
  const delayValue = Number(body?.delayValue);
  const delayUnit = String(body?.delayUnit ?? "minutes");
  const ativo = body?.ativo === true;
  const cancelPrevious = body?.cancelPrevious === true;

  let delaySeconds: number;
  try {
    delaySeconds = delayToSeconds(delayValue, delayUnit);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Delay inválido" }, 400);
  }

  await db
    .update(flowSteps)
    .set({ delaySeconds, ativo, cancelPrevious, atualizadoEm: new Date() })
    .where(eq(flowSteps.id, id));
  return c.json({ ok: true });
});

/* ==========================================================================
 * DELETE /api/automacoes/flow-steps/:id
 * Apaga step + template auto-gerado se não está em uso.
 * ========================================================================== */
automacoesRoutes.delete("/flow-steps/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID inválido" }, 400);

  const step = await db.query.flowSteps.findFirst({ where: eq(flowSteps.id, id) });
  if (!step) return c.json({ error: "Passo não encontrado" }, 404);

  await db.delete(flowSteps).where(eq(flowSteps.id, id));

  const stillInUse = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.templateKey, step.templateKey));
  const isAutoGenerated = step.templateKey.startsWith(step.gatewayEvent + "_");
  if (stillInUse.length === 0 && isAutoGenerated) {
    await db.delete(messageTemplates).where(eq(messageTemplates.key, step.templateKey));
  }
  return c.json({ ok: true });
});

/* ==========================================================================
 * POST /api/automacoes/messages  (create message in event = template + step)
 * ========================================================================== */
const createMessageSchema = z.object({
  gatewayEvent: z.string().min(1),
  nome: z.string().min(1),
  conteudo: z.string().min(1).max(4000),
  delayValue: z.number(),
  delayUnit: z.string().default("hours"),
});
automacoesRoutes.post("/messages", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = createMessageSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);
  }
  const { gatewayEvent, nome, conteudo, delayValue, delayUnit } = parsed.data;

  let delaySeconds: number;
  try {
    delaySeconds = delayToSeconds(delayValue, delayUnit);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Delay inválido" }, 400);
  }

  const existing = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.gatewayEvent, gatewayEvent));
  if (existing.length >= 5) return c.json({ error: "Máximo de 5 mensagens por evento" }, 409);

  const baseKey = slugify(nome, 30);
  if (!baseKey) return c.json({ error: "Não foi possível gerar key" }, 400);

  let key = `${gatewayEvent}_${baseKey}`;
  let suffix = 1;
  while (
    await db.query.messageTemplates.findFirst({
      where: eq(messageTemplates.key, key as never),
    })
  ) {
    suffix++;
    key = `${gatewayEvent}_${baseKey}_${suffix}`;
    if (suffix > 50) return c.json({ error: "Não foi possível gerar key única" }, 500);
  }

  await db.insert(messageTemplates).values({
    key: key as never,
    nome,
    descricao: null,
    conteudo,
    conteudoDefault: conteudo,
    placeholdersDisponiveis: ["primeiroNome", "nome", "valor", "link_pix", "link_checkout"],
  });

  const maxOrdem = existing.reduce((m, s) => (s.ordem > m ? s.ordem : m), 0);
  await db.insert(flowSteps).values({
    gatewayEvent,
    ordem: maxOrdem + 1,
    templateKey: key as never,
    delaySeconds,
    ativo: true,
    cancelPrevious: false,
  });

  return c.json({ ok: true, key });
});

/* ==========================================================================
 * DELETE /api/automacoes/eventos/:gatewayEvent
 * Apaga TODOS os passos de um evento + templates auto-gerados.
 * ========================================================================== */
automacoesRoutes.delete("/eventos/:gatewayEvent", async (c) => {
  const gatewayEvent = c.req.param("gatewayEvent");
  if (!gatewayEvent) return c.json({ error: "Evento obrigatório" }, 400);

  const steps = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.gatewayEvent, gatewayEvent));

  await db.delete(flowSteps).where(eq(flowSteps.gatewayEvent, gatewayEvent));

  for (const s of steps) {
    if (!s.templateKey.startsWith(gatewayEvent + "_")) continue;
    const usedElsewhere = await db
      .select()
      .from(flowSteps)
      .where(eq(flowSteps.templateKey, s.templateKey));
    if (usedElsewhere.length === 0) {
      await db.delete(messageTemplates).where(eq(messageTemplates.key, s.templateKey));
    }
  }

  return c.json({ ok: true, removed: steps.length });
});
