import { Hono } from "hono";
import { db } from "../../db/client.js";
import {
  personas,
  PERSONA_PRIORIDADES,
  PERSONA_VOLUMES,
  PERSONA_RISCOS,
  type PersonaPrioridade,
  type PersonaVolume,
  type PersonaRisco,
} from "../../db/schema.js";
import { and, asc, eq } from "drizzle-orm";

export const personasRoutes = new Hono();

const PRIORIDADE_ORDEM: Record<PersonaPrioridade, number> = {
  primaria: 0,
  secundaria: 1,
  terciaria: 2,
  explorando: 3,
  descartada: 4,
};

/**
 * GET /api/personas?produtoId=1
 * Lista personas ATIVAS do produto. Ordenado por prioridade (primária →
 * descartada). Sem filtro de produto = lista todas (uso admin).
 */
personasRoutes.get("/", async (c) => {
  const produtoIdRaw = c.req.query("produtoId");
  const incluirInativas = c.req.query("incluir_inativas") === "1";
  const where = [];
  if (produtoIdRaw) where.push(eq(personas.produtoId, Number(produtoIdRaw)));
  if (!incluirInativas) where.push(eq(personas.ativo, true));
  const list = await db
    .select()
    .from(personas)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(personas.criadoEm));
  // Ordenação por prioridade (primária primeiro), nome como tiebreaker.
  list.sort((a, b) => {
    const pa = PRIORIDADE_ORDEM[a.prioridade] ?? 99;
    const pb = PRIORIDADE_ORDEM[b.prioridade] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.nome.localeCompare(b.nome);
  });
  return c.json(list);
});

personasRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id invalido" }, 400);
  const [row] = await db.select().from(personas).where(eq(personas.id, id));
  if (!row) return c.json({ error: "nao encontrado" }, 404);
  return c.json(row);
});

type PersonaInput = {
  produtoId?: number | null;
  nome: string;
  slug?: string | null;
  cor?: string | null;
  descricao?: string | null;
  demografia?: string | null;
  dor?: string | null;
  desejo?: string | null;
  objecoes?: string[] | null;
  mensagemChave?: string | null;
  volumeMensal?: PersonaVolume | null;
  wtpEstimado?: PersonaVolume | null;
  churnRisk?: PersonaRisco | null;
  pctPublicoAtual?: number | null;
  prioridade?: PersonaPrioridade;
  lps?: string[] | null;
  canais?: string[] | null;
  notas?: string | null;
  ativo?: boolean;
};

function normalizeInput(b: PersonaInput) {
  const objecoes = Array.isArray(b.objecoes) ? b.objecoes.filter(Boolean) : [];
  const lps = Array.isArray(b.lps) ? b.lps.filter(Boolean) : [];
  const canais = Array.isArray(b.canais) ? b.canais.filter(Boolean) : [];
  return {
    produtoId: b.produtoId ?? null,
    nome: b.nome.trim(),
    slug: b.slug?.trim() || null,
    cor: b.cor?.trim() || null,
    descricao: b.descricao?.trim() || null,
    demografia: b.demografia?.trim() || null,
    dor: b.dor?.trim() || null,
    desejo: b.desejo?.trim() || null,
    objecoes,
    mensagemChave: b.mensagemChave?.trim() || null,
    volumeMensal: b.volumeMensal ?? null,
    wtpEstimado: b.wtpEstimado ?? null,
    churnRisk: b.churnRisk ?? null,
    pctPublicoAtual:
      typeof b.pctPublicoAtual === "number" ? b.pctPublicoAtual : null,
    prioridade: b.prioridade ?? "explorando",
    lps,
    canais,
    notas: b.notas?.trim() || null,
    ativo: b.ativo ?? true,
  };
}

personasRoutes.post("/", async (c) => {
  const body = (await c.req.json()) as PersonaInput;
  if (!body?.nome?.trim()) return c.json({ error: "nome obrigatorio" }, 400);
  if (body.prioridade && !PERSONA_PRIORIDADES.includes(body.prioridade as PersonaPrioridade))
    return c.json({ error: "prioridade invalida" }, 400);
  if (body.volumeMensal && !PERSONA_VOLUMES.includes(body.volumeMensal as PersonaVolume))
    return c.json({ error: "volumeMensal invalido" }, 400);
  if (body.wtpEstimado && !PERSONA_VOLUMES.includes(body.wtpEstimado as PersonaVolume))
    return c.json({ error: "wtpEstimado invalido" }, 400);
  if (body.churnRisk && !PERSONA_RISCOS.includes(body.churnRisk as PersonaRisco))
    return c.json({ error: "churnRisk invalido" }, 400);
  const data = normalizeInput(body);
  const [row] = await db.insert(personas).values(data).returning();
  return c.json(row, 201);
});

personasRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id invalido" }, 400);
  const body = (await c.req.json()) as Partial<PersonaInput>;
  const patch: Record<string, unknown> = { atualizadoEm: new Date() };
  if (body.produtoId !== undefined) patch.produtoId = body.produtoId;
  if (body.nome !== undefined) patch.nome = body.nome.trim();
  if (body.slug !== undefined) patch.slug = body.slug?.trim() || null;
  if (body.cor !== undefined) patch.cor = body.cor?.trim() || null;
  if (body.descricao !== undefined) patch.descricao = body.descricao?.trim() || null;
  if (body.demografia !== undefined) patch.demografia = body.demografia?.trim() || null;
  if (body.dor !== undefined) patch.dor = body.dor?.trim() || null;
  if (body.desejo !== undefined) patch.desejo = body.desejo?.trim() || null;
  if (body.objecoes !== undefined)
    patch.objecoes = Array.isArray(body.objecoes) ? body.objecoes.filter(Boolean) : [];
  if (body.mensagemChave !== undefined) patch.mensagemChave = body.mensagemChave?.trim() || null;
  if (body.volumeMensal !== undefined) patch.volumeMensal = body.volumeMensal;
  if (body.wtpEstimado !== undefined) patch.wtpEstimado = body.wtpEstimado;
  if (body.churnRisk !== undefined) patch.churnRisk = body.churnRisk;
  if (body.pctPublicoAtual !== undefined) patch.pctPublicoAtual = body.pctPublicoAtual;
  if (body.prioridade !== undefined) patch.prioridade = body.prioridade;
  if (body.lps !== undefined)
    patch.lps = Array.isArray(body.lps) ? body.lps.filter(Boolean) : [];
  if (body.canais !== undefined)
    patch.canais = Array.isArray(body.canais) ? body.canais.filter(Boolean) : [];
  if (body.notas !== undefined) patch.notas = body.notas?.trim() || null;
  if (body.ativo !== undefined) patch.ativo = body.ativo;
  const [row] = await db
    .update(personas)
    .set(patch)
    .where(eq(personas.id, id))
    .returning();
  if (!row) return c.json({ error: "nao encontrado" }, 404);
  return c.json(row);
});

personasRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id invalido" }, 400);
  await db.delete(personas).where(eq(personas.id, id));
  return c.json({ ok: true });
});
