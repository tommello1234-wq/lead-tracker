/**
 * Auth helpers — versão server-side sem dependências do Next.
 * Cookie httpOnly comparado contra token derivado de APP_PASSWORD + SESSION_SECRET.
 */
export const SESSION_COOKIE = "lt_session";

export function expectedToken(): string {
  const pw = process.env.APP_PASSWORD ?? "";
  const secret = process.env.SESSION_SECRET ?? "lt-default-secret";
  return Buffer.from(`${pw}:${secret}`).toString("base64");
}

export function isValidToken(token: string | undefined): boolean {
  if (!token) return false;
  return token === expectedToken();
}
