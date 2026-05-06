/**
 * Cliente da API Asaas (REST com header `access_token`).
 * Docs: https://docs.asaas.com
 *
 * ENVs necessários:
 *  - ASAAS_API_KEY (chave começando com $aact_)
 *  - ASAAS_API_URL (opcional — default api.asaas.com/v3 produção,
 *    sandbox = api-sandbox.asaas.com/v3)
 */

const PROD_URL = "https://api.asaas.com/v3";

function ensureKey(): { url: string; key: string } {
  const url = (process.env.ASAAS_API_URL ?? PROD_URL).replace(/\/+$/, "");
  const key = process.env.ASAAS_API_KEY;
  if (!key) {
    throw new Error("ASAAS_API_KEY não configurada");
  }
  return { url, key };
}

export type AsaasCustomer = {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  mobilePhone?: string;
  cpfCnpj?: string;
};

async function asaasFetch<T>(path: string): Promise<T> {
  const { url, key } = ensureKey();
  const res = await fetch(`${url}${path}`, {
    headers: {
      access_token: key,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Asaas ${path} falhou: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Busca dados completos do customer pelo ID. Cache em memória 10min
 * pra evitar chamadas repetidas dentro do mesmo deploy.
 */
const customerCache = new Map<string, { data: AsaasCustomer; expiresAt: number }>();

export async function getAsaasCustomer(id: string): Promise<AsaasCustomer | null> {
  if (!id) return null;
  const cached = customerCache.get(id);
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.data;

  try {
    const data = await asaasFetch<AsaasCustomer>(`/customers/${id}`);
    customerCache.set(id, { data, expiresAt: now + 10 * 60_000 });
    return data;
  } catch (e) {
    console.error("[asaas-api] getCustomer falhou:", e instanceof Error ? e.message : e);
    return null;
  }
}
