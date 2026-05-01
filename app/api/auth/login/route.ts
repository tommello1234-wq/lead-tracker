import { NextResponse } from "next/server";
import { expectedToken, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = form.get("password");
  const from = (form.get("from") as string) || "/dashboard";

  if (typeof password !== "string" || password !== process.env.APP_PASSWORD) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    if (from) url.searchParams.set("from", from);
    return NextResponse.redirect(url, { status: 303 });
  }

  const res = NextResponse.redirect(new URL(from, req.url), { status: 303 });
  res.cookies.set(SESSION_COOKIE, expectedToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
