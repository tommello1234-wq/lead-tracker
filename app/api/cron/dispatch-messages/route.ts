import { NextResponse } from "next/server";
import { dispatchPending } from "@/lib/messages";

/**
 * Cron endpoint chamado pela Vercel (vercel.json) ou cron externo.
 * Protegido por CRON_SECRET no header `Authorization: Bearer <secret>`.
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  const secret = process.env.CRON_SECRET;

  if (secret && auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await dispatchPending();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Erro" },
      { status: 500 },
    );
  }
}

export const dynamic = "force-dynamic";
