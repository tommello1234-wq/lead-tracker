"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { PERIODS, type Period } from "@/lib/period";

const PRODUTO_COOKIE = "lt-produto-id";
const PERIOD_COOKIE = "lt-period";

/**
 * Lê o produto selecionado do cookie.
 * Retorna `null` = "Todos os produtos" (visão agregada).
 */
export async function getSelectedProdutoId(): Promise<number | null> {
  const c = await cookies();
  const v = c.get(PRODUTO_COOKIE)?.value;
  if (!v || v === "all") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Define produto selecionado e revalida páginas.
 */
export async function setSelectedProdutoId(id: number | null): Promise<void> {
  const c = await cookies();
  c.set(PRODUTO_COOKIE, id == null ? "all" : String(id), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}

/**
 * Lê o período selecionado do cookie. Default: 30d.
 */
export async function getSelectedPeriod(): Promise<Period> {
  const c = await cookies();
  const v = c.get(PERIOD_COOKIE)?.value as Period | undefined;
  if (v && (PERIODS as readonly string[]).includes(v)) return v;
  return "30d";
}

export async function setSelectedPeriod(period: Period): Promise<void> {
  const c = await cookies();
  c.set(PERIOD_COOKIE, period, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
  revalidatePath("/", "layout");
}

/**
 * Salva o período no cookie SEM revalidar.
 * Usado pelo PeriodSelector — a mudança de URL já dispara o re-fetch
 * dos componentes; o cookie só persiste a preferência pro próximo load.
 */
export async function persistPeriodCookie(period: Period): Promise<void> {
  const c = await cookies();
  c.set(PERIOD_COOKIE, period, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
