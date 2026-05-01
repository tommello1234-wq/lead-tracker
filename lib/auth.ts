import { cookies } from "next/headers";

const COOKIE_NAME = "lt_session";

export async function isAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  const c = jar.get(COOKIE_NAME);
  if (!c) return false;
  return c.value === expectedToken();
}

export function expectedToken(): string {
  const pw = process.env.APP_PASSWORD ?? "";
  const secret = process.env.SESSION_SECRET ?? "lt-default-secret";
  return Buffer.from(`${pw}:${secret}`).toString("base64");
}

export const SESSION_COOKIE = COOKIE_NAME;
