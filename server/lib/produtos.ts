import { db } from "../../db/client";
import { produtos, type Produto } from "../../db/schema";
import { eq, sql } from "drizzle-orm";

/**
 * Busca produto pelo nome que veio no payload do gateway.
 * Tenta match exato em `nome`, depois em qualquer string de `gateway_match`.
 * Se não encontrar, cria automaticamente com tipo "indefinido" — user classifica
 * depois pelo dashboard.
 */
export async function findOrCreateProdutoByName(
  rawName: string,
): Promise<Produto | null> {
  const nome = rawName.trim();
  if (!nome) return null;

  // Match exato (case-insensitive)
  const exact = await db.query.produtos.findFirst({
    where: sql`lower(${produtos.nome}) = lower(${nome})`,
  });
  if (exact) return exact;

  // Match em gateway_match (qualquer string da lista)
  const byMatch = await db
    .select()
    .from(produtos)
    .where(
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(${produtos.gatewayMatch}) AS m
        WHERE lower(m) = lower(${nome}) OR lower(${nome}) LIKE '%' || lower(m) || '%'
      )`,
    )
    .limit(1);
  if (byMatch[0]) return byMatch[0];

  // Não achou — cria com tipo indefinido (user classifica depois)
  const [created] = await db
    .insert(produtos)
    .values({
      nome,
      tipo: "indefinido",
      gatewayMatch: [nome],
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  // Concorrência: outro request já criou
  return (
    (await db.query.produtos.findFirst({ where: eq(produtos.nome, nome) })) ?? null
  );
}
