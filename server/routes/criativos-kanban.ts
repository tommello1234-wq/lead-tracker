/**
 * /api/criativos-kanban
 * CRUD do Kanban de produção de criativos (ideia → produzido → testado → recusado).
 */
import { Hono } from "hono";
import { createClient } from "@supabase/supabase-js";
import { db } from "../../db/client.js";
import {
  criativoKanban,
  CRIATIVO_KANBAN_ETAPAS,
  CRIATIVO_TIPOS,
  type CriativoKanbanEtapa,
  type CriativoTipo,
} from "../../db/schema.js";
import { asc, eq } from "drizzle-orm";

export const criativosKanbanRoutes = new Hono();

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_PREFIXES = ["image/", "video/"];
const BUCKET_NAME = "criativos-kanban";

/**
 * Cliente Supabase pra Storage. Usa SERVICE_ROLE_KEY (bypass RLS) pra
 * permitir upload server-side sem precisar de policies complexas.
 *
 * Envs necessárias (já configuradas no Vercel):
 * - SUPABASE_URL: https://<ref>.supabase.co
 * - SUPABASE_SERVICE_ROLE_KEY: service role key do projeto Supabase
 */
function getSupabaseClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados",
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * POST /api/criativos-kanban/upload
 * Multipart upload pra Supabase Storage (bucket "criativos-kanban").
 * Aceita image/* ou video/*, até 50MB. Retorna { url, contentType, size }.
 *
 * Bucket precisa estar criado como PUBLIC no painel Supabase
 * (Storage → New bucket → criativos-kanban → Public).
 */
criativosKanbanRoutes.post("/upload", async (c) => {
  const formData = await c.req.formData().catch(() => null);
  if (!formData) return c.json({ error: "form-data inválido" }, 400);
  const file = formData.get("file");
  if (!(file instanceof File)) return c.json({ error: "arquivo obrigatório no campo 'file'" }, 400);

  if (file.size > MAX_UPLOAD_BYTES) {
    return c.json({ error: `arquivo > 50MB (recebeu ${(file.size / 1024 / 1024).toFixed(1)}MB)` }, 413);
  }
  const ct = file.type || "application/octet-stream";
  if (!ALLOWED_PREFIXES.some((p) => ct.startsWith(p))) {
    return c.json({ error: `tipo não suportado (${ct}). Apenas image/* e video/*` }, 415);
  }

  // Path único dentro do bucket: <timestamp>-<random>-<safe-name>
  const safe = (file.name || "arquivo").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const random = Math.random().toString(36).slice(2, 10);
  const path = `${Date.now()}-${random}-${safe}`;

  try {
    const supabase = getSupabaseClient();
    const buffer = await file.arrayBuffer();
    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(path, buffer, {
        contentType: ct,
        cacheControl: "31536000", // 1 year — arquivos são imutáveis (path único)
        upsert: false,
      });
    if (error) return c.json({ error: error.message }, 500);

    // URL pública do arquivo (bucket precisa ser public)
    const { data } = supabase.storage.from(BUCKET_NAME).getPublicUrl(path);
    return c.json({ url: data.publicUrl, contentType: ct, size: file.size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "upload falhou";
    return c.json({ error: msg }, 500);
  }
});

/** GET /api/criativos-kanban — lista tudo agrupado por etapa */
criativosKanbanRoutes.get("/", async (c) => {
  const rows = await db
    .select()
    .from(criativoKanban)
    .orderBy(asc(criativoKanban.ordem), asc(criativoKanban.criadoEm));
  return c.json(rows);
});

/** GET /api/criativos-kanban/:id */
criativosKanbanRoutes.get("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id inválido" }, 400);
  const [row] = await db.select().from(criativoKanban).where(eq(criativoKanban.id, id));
  if (!row) return c.json({ error: "não encontrado" }, 404);
  return c.json(row);
});

type Input = {
  titulo?: string;
  descricao?: string | null;
  tipo?: CriativoTipo;
  etapa?: CriativoKanbanEtapa;
  ordem?: number;
  thumbUrl?: string | null;
  url?: string | null;
  anguloId?: number | null;
  notas?: string | null;
};

function sanitize(b: Input) {
  const out: Record<string, unknown> = {};
  if (b.titulo !== undefined) out.titulo = String(b.titulo).trim();
  if (b.descricao !== undefined) out.descricao = b.descricao ?? null;
  if (b.tipo !== undefined && (CRIATIVO_TIPOS as readonly string[]).includes(b.tipo)) out.tipo = b.tipo;
  if (b.etapa !== undefined && (CRIATIVO_KANBAN_ETAPAS as readonly string[]).includes(b.etapa)) out.etapa = b.etapa;
  if (b.ordem !== undefined) out.ordem = Number(b.ordem) || 0;
  if (b.thumbUrl !== undefined) out.thumbUrl = b.thumbUrl?.trim() || null;
  if (b.url !== undefined) out.url = b.url?.trim() || null;
  if (b.anguloId !== undefined) out.anguloId = b.anguloId === null ? null : Number(b.anguloId);
  if (b.notas !== undefined) out.notas = b.notas ?? null;
  return out;
}

/** POST /api/criativos-kanban — cria novo */
criativosKanbanRoutes.post("/", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Input;
  if (!body.titulo || !String(body.titulo).trim()) {
    return c.json({ error: "titulo obrigatório" }, 400);
  }
  const data = sanitize(body) as { titulo: string };
  const [row] = await db.insert(criativoKanban).values(data).returning();
  return c.json(row, 201);
});

/** PATCH /api/criativos-kanban/:id — atualiza campos (etapa, ordem, etc.) */
criativosKanbanRoutes.patch("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id inválido" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Input;
  const data = sanitize(body);
  if (Object.keys(data).length === 0) return c.json({ error: "nada pra atualizar" }, 400);
  data.atualizadoEm = new Date();
  const [row] = await db
    .update(criativoKanban)
    .set(data)
    .where(eq(criativoKanban.id, id))
    .returning();
  if (!row) return c.json({ error: "não encontrado" }, 404);
  return c.json(row);
});

/** DELETE /api/criativos-kanban/:id */
criativosKanbanRoutes.delete("/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) return c.json({ error: "id inválido" }, 400);
  const [row] = await db
    .delete(criativoKanban)
    .where(eq(criativoKanban.id, id))
    .returning();
  if (!row) return c.json({ error: "não encontrado" }, 404);
  return c.json({ ok: true });
});
