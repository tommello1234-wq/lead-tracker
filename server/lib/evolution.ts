/**
 * Cliente para Evolution API.
 * Docs: https://doc.evolution-api.com/
 *
 * ENVs necessarios:
 *  - EVOLUTION_API_URL    (ex: https://evo.seudominio.com)
 *  - EVOLUTION_API_KEY    (apikey global)
 *  - EVOLUTION_INSTANCE_NAME (nome da instancia conectada)
 */

const URL = () => process.env.EVOLUTION_API_URL?.replace(/\/+$/, "");
const KEY = () => process.env.EVOLUTION_API_KEY;
const INSTANCE = () => process.env.EVOLUTION_INSTANCE_NAME;

export class EvolutionError extends Error {
  status?: number;
  body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function ensureConfigured() {
  const url = URL();
  const key = KEY();
  const instance = INSTANCE();
  if (!url || !key || !instance) {
    throw new EvolutionError(
      "Evolution API nao configurada. Defina EVOLUTION_API_URL, EVOLUTION_API_KEY e EVOLUTION_INSTANCE_NAME.",
    );
  }
  return { url, key, instance };
}

/**
 * Normaliza numero de telefone para o formato aceito pela Evolution.
 * Aceita: "+55 11 99999-9999", "(11) 99999-9999", "5511999999999"
 * Retorna apenas digitos com DDI.
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  // Se nao tem DDI (Brasil 55), adiciona
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits;
}

/**
 * Variantes BR de um telefone pra matching robusto: com e sem o 9º dígito.
 *
 * WhatsApp manda o remoteJid SEM o 9º dígito (ex: 558293359337 = 12díg),
 * mas a gente salva o contato COM o 9 (ex: 5582993359337 = 13díg). Esse
 * helper devolve as 2 formas pra casar nos dois sentidos.
 */
export function phoneVariants(raw: string): string[] {
  const d = raw.replace(/\D/g, "");
  const local = d.startsWith("55") ? d.slice(2) : d; // tira DDI
  if (local.length < 10) return [d]; // não-BR ou inválido → usa cru
  const ddd = local.slice(0, 2);
  const sub = local.slice(2); // 8 ou 9 dígitos
  const sub8 = sub.length === 9 && sub.startsWith("9") ? sub.slice(1) : sub;
  const sub9 = sub8.length === 8 ? "9" + sub8 : sub8;
  return Array.from(new Set([
    `55${ddd}${sub8}`, // 12 díg (sem 9)
    `55${ddd}${sub9}`, // 13 díg (com 9)
  ]));
}

export type SendTextResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
  status?: number;
};

export async function sendText(
  numero: string,
  texto: string,
  opts?: { delay?: number },
): Promise<SendTextResult> {
  try {
    const { url, key, instance } = ensureConfigured();
    const phone = normalizePhone(numero);

    const res = await fetch(`${url}/message/sendText/${instance}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
      },
      body: JSON.stringify({
        number: phone,
        text: texto,
        delay: opts?.delay ?? 1200,
      }),
    });

    const body = (await res.json().catch(() => ({}))) as {
      key?: { id?: string };
      message?: string;
      error?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: body?.message ?? body?.error ?? `HTTP ${res.status}`,
      };
    }

    return { ok: true, messageId: body?.key?.id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Erro desconhecido",
    };
  }
}

export async function checkInstanceConnection(): Promise<{
  connected: boolean;
  state?: string;
  error?: string;
}> {
  try {
    const { url, key, instance } = ensureConfigured();
    const res = await fetch(`${url}/instance/connectionState/${instance}`, {
      headers: { apikey: key },
    });
    if (!res.ok) {
      return { connected: false, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as { instance?: { state?: string } };
    const state = body?.instance?.state;
    return { connected: state === "open", state };
  } catch (e) {
    return {
      connected: false,
      error: e instanceof Error ? e.message : "Erro desconhecido",
    };
  }
}
