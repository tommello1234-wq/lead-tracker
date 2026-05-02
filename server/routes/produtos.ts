import { Hono } from "hono";
import { db } from "@db/client";
import { produtos } from "@db/schema";
import { asc } from "drizzle-orm";

export const produtosRoutes = new Hono();

/**
 * GET /api/produtos
 * Lista todos produtos ativos.
 */
produtosRoutes.get("/", async (c) => {
  const list = await db
    .select()
    .from(produtos)
    .orderBy(asc(produtos.nome));
  return c.json(list);
});
