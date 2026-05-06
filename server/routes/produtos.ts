import { Hono } from "hono";
import { db } from "../../db/client.js";
import { produtos } from "../../db/schema.js";
import { asc, eq } from "drizzle-orm";

export const produtosRoutes = new Hono();

/**
 * GET /api/produtos
 * Lista produtos ATIVOS por padrão. Use ?incluir_inativos=1 pra incluir
 * descontinuados (ex: Gravyx Lançamento) — útil pra admin/auditoria.
 */
produtosRoutes.get("/", async (c) => {
  const incluirInativos = c.req.query("incluir_inativos") === "1";
  const list = incluirInativos
    ? await db.select().from(produtos).orderBy(asc(produtos.nome))
    : await db
        .select()
        .from(produtos)
        .where(eq(produtos.ativo, true))
        .orderBy(asc(produtos.nome));
  return c.json(list);
});
