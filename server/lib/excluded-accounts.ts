/**
 * Contas excluídas dos relatórios — testes do admin, auto-compras, etc.
 *
 * Sync (asaas/ticto/stripe) e webhooks usam isExcludedAccount() pra filtrar
 * essas contas ANTES de criar lead. Sem isso, deletar o lead resolve por
 * uma noite — o sync no dia seguinte recria via customer do gateway.
 *
 * Compara case-insensitive em email + contato (DDI+DDD+número, só dígitos).
 * Adiciona aqui qualquer email/telefone que não deve poluir métricas.
 */

const EXCLUDED_EMAILS = new Set([
  "washingtonmelo1234@gmail.com",
  "washingtonmello782@gmail.com",
  "upwardcreativeacademy@gmail.com",
  "tommello1234@gmail.com",
  "taianesousaml2017@gmail.com",
]);

const EXCLUDED_PHONES = new Set([
  "5588992089323", // Washington
]);

const EXCLUDED_CPFS = new Set<string>([
  // adicionar CPFs se necessário (formato só dígitos)
]);

function normalizePhone(p: string | null | undefined): string {
  if (!p) return "";
  return String(p).replace(/\D/g, "");
}

function normalizeEmail(e: string | null | undefined): string {
  if (!e) return "";
  return String(e).trim().toLowerCase();
}

function normalizeCpf(c: string | null | undefined): string {
  if (!c) return "";
  return String(c).replace(/\D/g, "");
}

export function isExcludedAccount(args: {
  email?: string | null;
  phone?: string | null;
  cpf?: string | null;
}): boolean {
  const email = normalizeEmail(args.email);
  if (email && EXCLUDED_EMAILS.has(email)) return true;
  const phone = normalizePhone(args.phone);
  if (phone && EXCLUDED_PHONES.has(phone)) return true;
  const cpf = normalizeCpf(args.cpf);
  if (cpf && EXCLUDED_CPFS.has(cpf)) return true;
  return false;
}
