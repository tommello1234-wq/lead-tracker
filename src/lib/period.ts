export const PERIODS = [
  "today",
  "yesterday",
  "hoje-ontem",
  "7d",
  "14d",
  "30d",
  "month",
  "max",
  "all",
  "custom",
] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "hoje-ontem": "Hoje e ontem",
  "7d": "Últimos 7 dias",
  "14d": "Últimos 14 dias",
  "30d": "Últimos 30 dias",
  month: "Este mês",
  max: "Máximo",
  all: "Tudo (histórico)",
  custom: "Personalizado",
};

/**
 * Retorna o dia formatado YYYY-MM-DD no fuso de São Paulo, independente
 * do TZ do browser do user. Crucial pra "Hoje" significar "hoje em BRT"
 * mesmo se o browser estiver com fuso diferente.
 */
function dayKeyBRT(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Início do dia em BRT (UTC-3, sem DST desde 2019).
 * Hoje em BRT é "2026-05-03" → retorna 2026-05-03T03:00:00Z (= 00:00 BRT).
 */
function startOfDay(d: Date): Date {
  return new Date(`${dayKeyBRT(d)}T03:00:00Z`);
}

/**
 * Fim do dia em BRT = próximo dia 02:59:59.999 UTC.
 */
function endOfDay(d: Date): Date {
  const start = startOfDay(d);
  return new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
}

/**
 * Resolve o período em uma `since: Date | null` (null = sem filtro).
 * Mantido pra compatibilidade — preferir `periodToRange` que devolve
 * since + until juntos.
 */
export function periodToSince(period: Period, customDate?: Date | null): Date | null {
  return periodToRange(period, customDate).since;
}

/**
 * Janela completa de um período: { since, until }.
 *
 * Convenção de "until":
 * - "today"/"month"/"all": until = NOW (inclui parcial de hoje)
 * - "yesterday": until = ontem 23:59 (dia completo, sem hoje)
 * - "7d"/"30d": until = ontem 23:59 (alinha com Meta UI "últimos N dias")
 * - "custom": until = customDate 23:59 (dia inteiro escolhido)
 */
export function periodToRange(
  period: Period,
  customDate?: Date | null,
  customRange?: { since: Date; until: Date } | null,
): { since: Date | null; until: Date } {
  const now = new Date();
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return d;
  };
  switch (period) {
    case "today":
      return { since: startOfDay(now), until: now };
    case "yesterday": {
      const d = daysAgo(1);
      return { since: startOfDay(d), until: endOfDay(d) };
    }
    case "hoje-ontem":
      return { since: startOfDay(daysAgo(1)), until: now };
    case "7d":
      return { since: startOfDay(daysAgo(7)), until: endOfDay(daysAgo(1)) };
    case "14d":
      return { since: startOfDay(daysAgo(14)), until: endOfDay(daysAgo(1)) };
    case "30d":
      return { since: startOfDay(daysAgo(30)), until: endOfDay(daysAgo(1)) };
    case "month": {
      const d = new Date(now);
      d.setDate(1);
      return { since: startOfDay(d), until: now };
    }
    case "custom": {
      // Range tem prioridade sobre single-day (mantido pra back-compat)
      if (customRange) {
        return { since: startOfDay(customRange.since), until: endOfDay(customRange.until) };
      }
      if (!customDate) return { since: null, until: now };
      return { since: startOfDay(customDate), until: endOfDay(customDate) };
    }
    case "max":
    case "all":
    default:
      return { since: null, until: now };
  }
}
