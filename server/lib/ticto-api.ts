/**
 * Cliente da API Ticto (REST OAuth2).
 *
 * Diferente do webhook (que recebe push), aqui FAZEMOS pull — pra:
 *  - backfill histórico (puxar tudo desde o início)
 *  - sync periódico (corrigir divergências)
 *  - lookups específicos por lead
 *
 * Auth: POST /security/oauth/token com client_credentials.
 * Token dura 1h, fazemos cache em memória.
 */
const BASE_URL = "https://glados.ticto.cloud/api";

type TokenCache = {
  token: string;
  expiresAt: number;
};

let tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.token;
  }

  const clientId = process.env.TICTO_CLIENT_ID;
  const clientSecret = process.env.TICTO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("TICTO_CLIENT_ID ou TICTO_CLIENT_SECRET não configurados");
  }

  const res = await fetch(`${BASE_URL}/security/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "*",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ticto auth falhou: ${res.status} ${body}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    token_type: string;
    expires_in: number;
  };

  tokenCache = {
    token: data.access_token,
    expiresAt: now + data.expires_in * 1000,
  };
  return data.access_token;
}

async function tictoFetch<T>(path: string, params?: Record<string, string | number>): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ticto ${path} falhou: ${res.status} ${body}`);
  }
  return res.json() as Promise<T>;
}

/* ============================================================
 * Endpoints públicos
 * ============================================================ */

export type TictoOrder = {
  // shape exato será mapeado depois que vermos a primeira resposta real
  hash?: string;
  id?: string | number;
  status?: string;
  payment_method?: string;
  amount?: number;
  paid_amount?: number;
  created_at?: string;
  customer?: {
    name?: string;
    email?: string;
    cpf?: string;
    cnpj?: string;
    phone?: { ddi?: string; ddd?: string; number?: string } | string;
  };
  item?: {
    product_name?: string;
    offer_name?: string;
    amount?: number;
  };
  [key: string]: unknown;
};

export type TictoSubscription = {
  id?: string | number;
  status?: string;
  successful_charges?: number;
  customer?: TictoOrder["customer"];
  product_name?: string;
  amount?: number;
  next_charge_at?: string;
  [key: string]: unknown;
};

export type Paginated<T> = {
  data: T[];
  meta?: {
    total?: number;
    page?: number;
    per_page?: number;
    last_page?: number;
  };
};

/** Resumo agregado de pedidos (count, total, etc). */
export function getOrdersSummary() {
  return tictoFetch<unknown>("/v1/orders/summary");
}

/**
 * Histórico paginado de pedidos.
 * filter[status]: aborted, delayed, authorized, chargeback, refunded, etc.
 * filter[transactionPaymentMethod]: credit_card, bank_slip, pix
 * filter[betweenDates]: MM/DD/YYYY,MM/DD/YYYY
 */
export function getOrdersHistory(
  page = 1,
  filters?: Record<string, string>,
) {
  const params: Record<string, string | number> = { page };
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      params[`filter[${k}]`] = v;
    }
  }
  return tictoFetch<Paginated<TictoOrder>>("/v1/orders/history", params);
}

/** Resumo agregado de assinaturas. */
export function getSubscriptionsSummary() {
  return tictoFetch<unknown>("/v1/subscriptions/summary");
}

/** Histórico paginado de assinaturas. */
export function getSubscriptionsHistory(page = 1, filters?: Record<string, string>) {
  const params: Record<string, string | number> = { page };
  if (filters) {
    for (const [k, v] of Object.entries(filters)) {
      params[`filter[${k}]`] = v;
    }
  }
  return tictoFetch<Paginated<TictoSubscription>>("/v1/subscriptions/history", params);
}
