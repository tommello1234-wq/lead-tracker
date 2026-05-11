import { Hono } from "hono";
import { db } from "../../db/client.js";
import { quizSessions, quizAnswers } from "../../db/schema.js";
import { eq, sql as drizzleSql, and, isNotNull, isNull } from "drizzle-orm";

/**
 * Quiz funnel — endpoints PÚBLICOS (sem requireAuth) chamados pelas LPs
 * no domínio gravyx.com.br. CORS já liberado em app.ts.
 *
 * Fluxo:
 *   1. LP carrega → JS gera uuid → POST /api/quiz/start
 *   2. Cada step respondido → POST /api/quiz/answer
 *   3. Final do quiz → POST /api/quiz/complete (com leadScore)
 *
 * Dashboard (com auth):
 *   GET /api/quiz/funnel?lpUrl=... → agregação por step
 */
export const quizRoutes = new Hono();

function trimOrNull(v: string | null | undefined) {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

// ============ POST /start ============
quizRoutes.post("/start", async (c) => {
  const body = (await c.req.json()) as {
    sessionId?: string;
    persona?: string | null;
    angulo?: string | null;
    lpUrl?: string | null;
    utm?: {
      source?: string | null;
      campaign?: string | null;
      medium?: string | null;
      content?: string | null;
      term?: string | null;
    };
  };

  if (!body?.sessionId || typeof body.sessionId !== "string") {
    return c.json({ error: "sessionId obrigatorio" }, 400);
  }
  // Sanity: uuid client-side ~ 36 chars, mas aceita até 64 pra ser flex
  if (body.sessionId.length > 64) {
    return c.json({ error: "sessionId invalido" }, 400);
  }

  const userAgent = c.req.header("user-agent") ?? null;
  const ipRaw =
    c.req.header("x-forwarded-for") ??
    c.req.header("x-real-ip") ??
    "";
  const ip = ipRaw.split(",")[0]?.trim() || null;

  // Upsert: se a session já existe (reload), só retorna o estado atual
  const existing = await db
    .select()
    .from(quizSessions)
    .where(eq(quizSessions.id, body.sessionId));

  if (existing.length > 0) {
    return c.json({ ok: true, existed: true, session: existing[0] });
  }

  const [row] = await db
    .insert(quizSessions)
    .values({
      id: body.sessionId,
      persona: trimOrNull(body.persona),
      angulo: trimOrNull(body.angulo),
      lpUrl: trimOrNull(body.lpUrl),
      utmSource: trimOrNull(body.utm?.source),
      utmCampaign: trimOrNull(body.utm?.campaign),
      utmMedium: trimOrNull(body.utm?.medium),
      utmContent: trimOrNull(body.utm?.content),
      utmTerm: trimOrNull(body.utm?.term),
      userAgent: userAgent?.slice(0, 500) ?? null,
      ip,
    })
    .returning();

  return c.json({ ok: true, existed: false, session: row }, 201);
});

// ============ POST /answer ============
quizRoutes.post("/answer", async (c) => {
  const body = (await c.req.json()) as {
    sessionId?: string;
    step?: number;
    question?: string;
    answer?: string;
  };

  if (!body?.sessionId || typeof body.sessionId !== "string") {
    return c.json({ error: "sessionId obrigatorio" }, 400);
  }
  if (typeof body.step !== "number" || body.step < 1 || body.step > 50) {
    return c.json({ error: "step invalido" }, 400);
  }
  if (!body.question || !body.answer) {
    return c.json({ error: "question/answer obrigatorios" }, 400);
  }

  // Valida que a session existe
  const [sess] = await db
    .select({ id: quizSessions.id })
    .from(quizSessions)
    .where(eq(quizSessions.id, body.sessionId));
  if (!sess) {
    return c.json({ error: "session nao encontrada" }, 404);
  }

  // Upsert: se já respondeu esse step antes (correção), substitui.
  // Não temos unique constraint — usar delete-then-insert pra simplicidade.
  await db
    .delete(quizAnswers)
    .where(
      and(
        eq(quizAnswers.sessionId, body.sessionId),
        eq(quizAnswers.step, body.step),
      ),
    );

  const [row] = await db
    .insert(quizAnswers)
    .values({
      sessionId: body.sessionId,
      step: body.step,
      question: String(body.question).slice(0, 200),
      answer: String(body.answer).slice(0, 500),
    })
    .returning();

  // Atualiza atualizadoEm da session pra ordenar últimas ativas
  await db
    .update(quizSessions)
    .set({ atualizadoEm: new Date() })
    .where(eq(quizSessions.id, body.sessionId));

  return c.json({ ok: true, answer: row }, 201);
});

// ============ POST /complete ============
quizRoutes.post("/complete", async (c) => {
  const body = (await c.req.json()) as {
    sessionId?: string;
    leadScore?: number;
    email?: string | null;
  };

  if (!body?.sessionId) {
    return c.json({ error: "sessionId obrigatorio" }, 400);
  }
  const score =
    typeof body.leadScore === "number"
      ? Math.max(0, Math.min(100, Math.round(body.leadScore)))
      : null;

  const [row] = await db
    .update(quizSessions)
    .set({
      leadScore: score,
      email: trimOrNull(body.email),
      completedAt: new Date(),
      atualizadoEm: new Date(),
    })
    .where(eq(quizSessions.id, body.sessionId))
    .returning();

  if (!row) {
    return c.json({ error: "session nao encontrada" }, 404);
  }
  return c.json({ ok: true, session: row });
});

// ============ GET /funnel?lpUrl=... ============
// Agregação por step pra dashboard. Requer auth (não exposto na LP).
quizRoutes.get("/funnel", async (c) => {
  const lpUrl = c.req.query("lpUrl");
  if (!lpUrl) {
    return c.json({ error: "lpUrl obrigatorio" }, 400);
  }

  const sessions = await db
    .select()
    .from(quizSessions)
    .where(eq(quizSessions.lpUrl, lpUrl));
  const totalSessions = sessions.length;
  const completed = sessions.filter((s) => s.completedAt != null).length;
  const scores = sessions.map((s) => s.leadScore).filter((s): s is number => s != null);
  const avgLeadScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  // Por step
  const answers = totalSessions
    ? await db
        .select()
        .from(quizAnswers)
        .where(
          drizzleSql`session_id IN (${drizzleSql.join(sessions.map((s) => drizzleSql`${s.id}`), drizzleSql`, `)})`,
        )
    : [];
  const byStep = new Map<number, Set<string>>(); // step → set de sessionIds que responderam
  for (const a of answers) {
    if (!byStep.has(a.step)) byStep.set(a.step, new Set());
    byStep.get(a.step)!.add(a.sessionId);
  }

  const maxStep = Math.max(0, ...Array.from(byStep.keys()));
  const steps = [] as Array<{
    step: number;
    reached: number;
    answered: number;
    dropOffRate: number;
  }>;
  let prevReached = totalSessions;
  for (let i = 1; i <= maxStep; i++) {
    const answered = byStep.get(i)?.size ?? 0;
    const reached = prevReached;
    const dropOffRate = reached > 0 ? ((reached - answered) / reached) * 100 : 0;
    steps.push({ step: i, reached, answered, dropOffRate });
    prevReached = answered;
  }

  return c.json({
    lpUrl,
    totalSessions,
    completed,
    completionRate: totalSessions > 0 ? (completed / totalSessions) * 100 : 0,
    avgLeadScore,
    steps,
  });
});

// ============ GET /sessions?lpUrl=...&completed=true ============
// Lista de sessions (pro dashboard). Auth-protected.
quizRoutes.get("/sessions", async (c) => {
  const lpUrl = c.req.query("lpUrl");
  const onlyCompleted = c.req.query("completed") === "true";
  const where = [];
  if (lpUrl) where.push(eq(quizSessions.lpUrl, lpUrl));
  if (onlyCompleted) where.push(isNotNull(quizSessions.completedAt));

  const list = await db
    .select()
    .from(quizSessions)
    .where(where.length ? and(...where) : undefined)
    .orderBy(drizzleSql`coalesce(completed_at, started_at) desc`)
    .limit(200);

  return c.json(list);
});
