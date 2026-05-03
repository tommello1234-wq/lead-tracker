import { Hono } from "hono";
import { z } from "zod";
import { db } from "../../db/client.js";
import {
  leads,
  LEAD_TYPES,
  LEAD_STATUS,
  LEAD_ORIGINS,
  type LeadStatus,
} from "../../db/schema.js";
import { eq } from "drizzle-orm";
import { getAllLeads } from "../lib/queries.js";
import { invalidateCache } from "../lib/cache.js";

export const leadsRoutes = new Hono();

const leadSchema = z.object({
  nome: z.string().min(1, "Nome obrigatório"),
  contato: z.string().optional().nullable(),
  tipo: z.enum(LEAD_TYPES),
  status: z.enum(LEAD_STATUS).default("novo"),
  origem: z.enum(LEAD_ORIGINS).optional().nullable(),
  valorEstimado: z.union([z.number(), z.string()]).optional().nullable(),
  observacoes: z.string().optional().nullable(),
  produtoId: z.number().int().positive().optional().nullable(),
});

function parseValor(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  return Number(String(v).replace(",", "."));
}

function timestampsForStatus(status: LeadStatus, now: Date) {
  return {
    primeiroContatoEm: status !== "novo" ? now : null,
    respondeuEm:
      status === "respondeu" || status === "convertido" || status === "reembolso_revertido"
        ? now
        : null,
    convertidoEm:
      status === "convertido" || status === "reembolso_revertido" ? now : null,
  };
}

/* ==========================================================================
 * GET /api/leads?produtoId=N
 * ========================================================================== */
leadsRoutes.get("/", async (c) => {
  const produtoIdParam = c.req.query("produtoId");
  const produtoId = produtoIdParam && produtoIdParam !== "all"
    ? Number(produtoIdParam) || null
    : null;
  const sinceParam = c.req.query("since");
  const untilParam = c.req.query("until");
  const since = sinceParam ? new Date(sinceParam) : null;
  const until = untilParam ? new Date(untilParam) : null;
  const list = await getAllLeads(
    produtoId,
    since && !Number.isNaN(since.getTime()) ? since : null,
    until && !Number.isNaN(until.getTime()) ? until : null,
  );
  return c.json(list);
});

/* ==========================================================================
 * POST /api/leads
 * ========================================================================== */
leadsRoutes.post("/", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);
  }
  const data = parsed.data;
  const now = new Date();
  const ts = timestampsForStatus(data.status, now);

  await db.insert(leads).values({
    nome: data.nome,
    contato: data.contato ?? null,
    tipo: data.tipo,
    status: data.status,
    origem: data.origem ?? null,
    valorEstimado: parseValor(data.valorEstimado),
    observacoes: data.observacoes ?? null,
    produtoId: data.produtoId ?? null,
    ...ts,
    criadoEm: now,
    atualizadoEm: now,
  });

  invalidateCache("sidebar-counts");
  return c.json({ ok: true });
});

/* ==========================================================================
 * PUT /api/leads/:id
 * ========================================================================== */
leadsRoutes.put("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "ID inválido" }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, 400);
  }
  const data = parsed.data;
  const now = new Date();

  const [prev] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!prev) return c.json({ error: "Lead não encontrado" }, 404);

  const updates: Record<string, unknown> = {
    nome: data.nome,
    contato: data.contato ?? null,
    tipo: data.tipo,
    status: data.status,
    origem: data.origem ?? null,
    valorEstimado: parseValor(data.valorEstimado),
    observacoes: data.observacoes ?? null,
    atualizadoEm: now,
  };

  if (data.status !== prev.status) {
    if (data.status !== "novo" && !prev.primeiroContatoEm) updates.primeiroContatoEm = now;
    if (
      (data.status === "respondeu" ||
        data.status === "convertido" ||
        data.status === "reembolso_revertido") &&
      !prev.respondeuEm
    ) {
      updates.respondeuEm = now;
    }
    if (
      (data.status === "convertido" || data.status === "reembolso_revertido") &&
      !prev.convertidoEm
    ) {
      updates.convertidoEm = now;
    }
  }

  await db.update(leads).set(updates).where(eq(leads.id, id));
  invalidateCache("sidebar-counts");
  return c.json({ ok: true });
});

/* ==========================================================================
 * PATCH /api/leads/:id/status
 * ========================================================================== */
leadsRoutes.patch("/:id/status", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "ID inválido" }, 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const status = body?.status as LeadStatus | undefined;
  if (!status || !LEAD_STATUS.includes(status)) {
    return c.json({ error: "Status inválido" }, 400);
  }

  const now = new Date();
  const [prev] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  if (!prev) return c.json({ error: "Lead não encontrado" }, 404);

  const updates: Record<string, unknown> = { status, atualizadoEm: now };
  if (status !== "novo" && !prev.primeiroContatoEm) updates.primeiroContatoEm = now;
  if (
    (status === "respondeu" || status === "convertido" || status === "reembolso_revertido") &&
    !prev.respondeuEm
  ) {
    updates.respondeuEm = now;
  }
  if (
    (status === "convertido" || status === "reembolso_revertido") &&
    !prev.convertidoEm
  ) {
    updates.convertidoEm = now;
  }

  await db.update(leads).set(updates).where(eq(leads.id, id));
  invalidateCache("sidebar-counts");
  return c.json({ ok: true });
});

/* ==========================================================================
 * DELETE /api/leads/:id
 * ========================================================================== */
leadsRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id <= 0) {
    return c.json({ error: "ID inválido" }, 400);
  }
  await db.delete(leads).where(eq(leads.id, id));
  invalidateCache("sidebar-counts");
  return c.json({ ok: true });
});
