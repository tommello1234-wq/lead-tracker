import { Hono } from "hono";
import { db } from "../../db/client.js";
import {
  angulos,
  criativos,
  ANGULO_STATUS,
  CRIATIVO_TIPOS,
  CRIATIVO_STATUS,
  type AnguloStatus,
  type CriativoTipo,
  type CriativoStatus,
} from "../../db/schema.js";
import { and, asc, desc, eq, ne } from "drizzle-orm";

export const angulosRoutes = new Hono();

const STATUS_ORDEM: Record<AnguloStatus, number> = {
  rodando: 0,
  vencedor: 1,
  producao: 2,
  ideia: 3,
  pausado: 4,
  perdedor: 5,
};

/**
 * GET /api/angulos
 * Lista ângulos. Filtros: ?personaId=1 (FK), ?produtoId=1, ?status=rodando.
 * Inclui criativos do ângulo aninhados (subquery — N+1 OK pra volume baixo).
 */
angulosRoutes.get("/", async (c) => {
  const personaId = c.req.query("personaId");
  const produtoId = c.req.query("produtoId");
  const status = c.req.query("status");
  const incluirInativos = c.req.query("incluir_inativos") === "1";

  const where = [];
  if (personaId) where.push(eq(angulos.personaId, Number(personaId)));
  if (produtoId) where.push(eq(angulos.produtoId, Number(produtoId)));
  if (status) where.push(eq(angulos.status, status as AnguloStatus));
  if (!incluirInativos) where.push(eq(angulos.ativo, true));

  const list = await db
    .select()
    .from(angulos)
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(angulos.criadoEm));

  list.sort((a, b) => {
    const sa = STATUS_ORDEM[a.status] ?? 99;
    const sb = STATUS_ORDEM[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.nome.localeCompare(b.nome);
  });

  // Anexa criativos (apenas ativos por padrão)
  const ids = list.map((a) => a.id);
  const criatList = ids.length
    ? await db
        .select()
        .from(criativos)
        .where(ne(criativos.status, "morto"))
        .orderBy(desc(criativos.criadoEm))
    : [];
  const byAngulo = new Map<number, typeof criatList>();
  for (const cr of criatList) {
    if (cr.anguloId == null) continue;
    if (!byAngulo.has(cr.anguloId)) byAngulo.set(cr.anguloId, []);
    byAngulo.get(cr.anguloId)!.push(cr);
  }

  const out = list.map((a) => ({ ...a, criativos: byAngulo.get(a.id) ?? [] }));
  return c.json(out);
});

angulosRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id invalido" }, 400);
  const [row] = await db.select().from(angulos).where(eq(angulos.id, id));
  if (!row) return c.json({ error: "nao encontrado" }, 404);
  const cr = await db
    .select()
    .from(criativos)
    .where(eq(criativos.anguloId, id))
    .orderBy(desc(criativos.criadoEm));
  return c.json({ ...row, criativos: cr });
});

type AnguloInput = {
  personaId?: number | null;
  produtoId?: number | null;
  nome: string;
  promessa?: string | null;
  hook?: string | null;
  cta?: string | null;
  status?: AnguloStatus;
  lpUrl?: string | null;
  lpScreenshot?: string | null;
  ctr?: number | null;
  cpa?: number | null;
  roas?: number | null;
  diasRodando?: number | null;
  budgetMensal?: number | null;
  notas?: string | null;
  ativo?: boolean;
};

function trimOrNull(v: string | null | undefined) {
  if (v == null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

angulosRoutes.post("/", async (c) => {
  const body = (await c.req.json()) as AnguloInput;
  if (!body?.nome?.trim()) return c.json({ error: "nome obrigatorio" }, 400);
  if (body.status && !ANGULO_STATUS.includes(body.status as AnguloStatus))
    return c.json({ error: "status invalido" }, 400);

  const data = {
    personaId: body.personaId ?? null,
    produtoId: body.produtoId ?? null,
    nome: body.nome.trim(),
    promessa: trimOrNull(body.promessa),
    hook: trimOrNull(body.hook),
    cta: trimOrNull(body.cta),
    status: body.status ?? "ideia",
    lpUrl: trimOrNull(body.lpUrl),
    lpScreenshot: trimOrNull(body.lpScreenshot),
    ctr: body.ctr ?? null,
    cpa: body.cpa ?? null,
    roas: body.roas ?? null,
    diasRodando: body.diasRodando ?? null,
    budgetMensal: body.budgetMensal ?? null,
    notas: trimOrNull(body.notas),
    ativo: body.ativo ?? true,
  };
  const [row] = await db.insert(angulos).values(data).returning();
  return c.json(row, 201);
});

angulosRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id invalido" }, 400);
  const body = (await c.req.json()) as Partial<AnguloInput>;
  const patch: Record<string, unknown> = { atualizadoEm: new Date() };
  if (body.personaId !== undefined) patch.personaId = body.personaId;
  if (body.produtoId !== undefined) patch.produtoId = body.produtoId;
  if (body.nome !== undefined) patch.nome = body.nome.trim();
  if (body.promessa !== undefined) patch.promessa = trimOrNull(body.promessa);
  if (body.hook !== undefined) patch.hook = trimOrNull(body.hook);
  if (body.cta !== undefined) patch.cta = trimOrNull(body.cta);
  if (body.status !== undefined) patch.status = body.status;
  if (body.lpUrl !== undefined) patch.lpUrl = trimOrNull(body.lpUrl);
  if (body.lpScreenshot !== undefined)
    patch.lpScreenshot = trimOrNull(body.lpScreenshot);
  if (body.ctr !== undefined) patch.ctr = body.ctr;
  if (body.cpa !== undefined) patch.cpa = body.cpa;
  if (body.roas !== undefined) patch.roas = body.roas;
  if (body.diasRodando !== undefined) patch.diasRodando = body.diasRodando;
  if (body.budgetMensal !== undefined) patch.budgetMensal = body.budgetMensal;
  if (body.notas !== undefined) patch.notas = trimOrNull(body.notas);
  if (body.ativo !== undefined) patch.ativo = body.ativo;
  const [row] = await db
    .update(angulos)
    .set(patch)
    .where(eq(angulos.id, id))
    .returning();
  if (!row) return c.json({ error: "nao encontrado" }, 404);
  return c.json(row);
});

angulosRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id invalido" }, 400);
  await db.delete(angulos).where(eq(angulos.id, id));
  return c.json({ ok: true });
});

// =============== Criativos (sub-resource) ===============

type CriativoInput = {
  anguloId?: number | null;
  tipo?: CriativoTipo;
  url?: string | null;
  thumbUrl?: string | null;
  headlineOverlay?: string | null;
  metaAdsId?: string | null;
  status?: CriativoStatus;
  ctr?: number | null;
  cpa?: number | null;
  impressoes?: number | null;
  notas?: string | null;
};

angulosRoutes.post("/:id/criativos", async (c) => {
  const anguloId = Number(c.req.param("id"));
  if (!Number.isFinite(anguloId)) return c.json({ error: "id invalido" }, 400);
  const body = (await c.req.json()) as CriativoInput;
  if (body.tipo && !CRIATIVO_TIPOS.includes(body.tipo))
    return c.json({ error: "tipo invalido" }, 400);
  if (body.status && !CRIATIVO_STATUS.includes(body.status))
    return c.json({ error: "status invalido" }, 400);
  const data = {
    anguloId,
    tipo: body.tipo ?? ("imagem" as CriativoTipo),
    url: trimOrNull(body.url),
    thumbUrl: trimOrNull(body.thumbUrl),
    headlineOverlay: trimOrNull(body.headlineOverlay),
    metaAdsId: trimOrNull(body.metaAdsId),
    status: body.status ?? ("ativo" as CriativoStatus),
    ctr: body.ctr ?? null,
    cpa: body.cpa ?? null,
    impressoes: body.impressoes ?? null,
    notas: trimOrNull(body.notas),
  };
  const [row] = await db.insert(criativos).values(data).returning();
  return c.json(row, 201);
});

angulosRoutes.patch("/criativos/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id invalido" }, 400);
  const body = (await c.req.json()) as Partial<CriativoInput>;
  const patch: Record<string, unknown> = { atualizadoEm: new Date() };
  if (body.tipo !== undefined) patch.tipo = body.tipo;
  if (body.url !== undefined) patch.url = trimOrNull(body.url);
  if (body.thumbUrl !== undefined) patch.thumbUrl = trimOrNull(body.thumbUrl);
  if (body.headlineOverlay !== undefined)
    patch.headlineOverlay = trimOrNull(body.headlineOverlay);
  if (body.metaAdsId !== undefined)
    patch.metaAdsId = trimOrNull(body.metaAdsId);
  if (body.status !== undefined) patch.status = body.status;
  if (body.ctr !== undefined) patch.ctr = body.ctr;
  if (body.cpa !== undefined) patch.cpa = body.cpa;
  if (body.impressoes !== undefined) patch.impressoes = body.impressoes;
  if (body.notas !== undefined) patch.notas = trimOrNull(body.notas);
  const [row] = await db
    .update(criativos)
    .set(patch)
    .where(eq(criativos.id, id))
    .returning();
  if (!row) return c.json({ error: "nao encontrado" }, 404);
  return c.json(row);
});

angulosRoutes.delete("/criativos/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id invalido" }, 400);
  await db.delete(criativos).where(eq(criativos.id, id));
  return c.json({ ok: true });
});

// =============== Import from Meta Ads ===============

type ImportPayload = {
  produtoId?: number | null;
  items: Array<{
    /** ID do ad no Meta (idempotência: evita duplicar import do mesmo ad) */
    metaAdsId: string;
    /** Nome do ângulo a criar */
    nome: string;
    personaId: number | null;
    hook?: string | null;
    promessa?: string | null;
    lpUrl?: string | null;
    status?: AnguloStatus;
    /** Métricas vindas do Meta */
    ctr?: number | null;
    cpa?: number | null;
    roas?: number | null;
    /** Criativo associado (cria 1 criativo por ad importado) */
    criativo?: {
      tipo?: CriativoTipo;
      url?: string | null;
      thumbUrl?: string | null;
      headlineOverlay?: string | null;
      ctr?: number | null;
      cpa?: number | null;
      impressoes?: number | null;
    } | null;
  }>;
};

/**
 * Import de ads do Meta como ângulos. Idempotente por meta_ads_id no
 * criativo — se já tem criativo com esse meta_ads_id, pula.
 */
angulosRoutes.post("/import-from-meta", async (c) => {
  const body = (await c.req.json()) as ImportPayload;
  if (!body?.items?.length) return c.json({ error: "items vazio" }, 400);

  // Pega criativos existentes com meta_ads_id pra dedupe
  const existing = await db.select().from(criativos);
  const existingMetaIds = new Set<string>();
  for (const cr of existing) if (cr.metaAdsId) existingMetaIds.add(cr.metaAdsId);

  const created: { anguloId: number; criativoId: number; metaAdsId: string }[] = [];
  const skipped: string[] = [];

  for (const item of body.items) {
    if (!item.metaAdsId || !item.nome?.trim()) continue;
    if (existingMetaIds.has(item.metaAdsId)) {
      skipped.push(item.metaAdsId);
      continue;
    }
    const [angulo] = await db
      .insert(angulos)
      .values({
        personaId: item.personaId ?? null,
        produtoId: body.produtoId ?? null,
        nome: item.nome.trim(),
        hook: trimOrNull(item.hook),
        promessa: trimOrNull(item.promessa),
        lpUrl: trimOrNull(item.lpUrl),
        status: item.status ?? "rodando",
        ctr: item.ctr ?? null,
        cpa: item.cpa ?? null,
        roas: item.roas ?? null,
      })
      .returning();

    const cr = item.criativo;
    let criativoId = -1;
    if (cr) {
      const [crRow] = await db
        .insert(criativos)
        .values({
          anguloId: angulo.id,
          tipo: cr.tipo ?? ("imagem" as CriativoTipo),
          url: trimOrNull(cr.url),
          thumbUrl: trimOrNull(cr.thumbUrl),
          headlineOverlay: trimOrNull(cr.headlineOverlay),
          metaAdsId: item.metaAdsId,
          status: "ativo",
          ctr: cr.ctr ?? null,
          cpa: cr.cpa ?? null,
          impressoes: cr.impressoes ?? null,
        })
        .returning();
      criativoId = crRow.id;
    }
    created.push({ anguloId: angulo.id, criativoId, metaAdsId: item.metaAdsId });
  }

  return c.json({ created: created.length, skipped: skipped.length, items: created });
});
