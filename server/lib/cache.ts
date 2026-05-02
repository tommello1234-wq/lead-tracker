/**
 * Cache in-memory simples com TTL — substitui unstable_cache do Next.
 *
 * Funciona perfeitamente em Node servers (persiste entre requests).
 * Em Vercel Functions cold-start o cache começa vazio, mas o TanStack Query
 * no frontend já cobre o caso de cache miss → primeira request lenta, demais rápidas.
 */
type CacheEntry<T> = { value: T; expiresAt: number };
const cache = new Map<string, CacheEntry<unknown>>();

export function withCache<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  keyPrefix: string,
  ttlSeconds: number,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    const key = `${keyPrefix}:${args.map((a) => JSON.stringify(a)).join(":")}`;
    const now = Date.now();
    const entry = cache.get(key) as CacheEntry<TResult> | undefined;
    if (entry && entry.expiresAt > now) {
      return entry.value;
    }
    const value = await fn(...args);
    cache.set(key, { value, expiresAt: now + ttlSeconds * 1000 });
    return value;
  };
}

/**
 * Invalida todas as entradas que comecem com `prefix`.
 * Útil pós-mutation: invalidate("dashboard") limpa todo cache do dashboard.
 */
export function invalidateCache(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
