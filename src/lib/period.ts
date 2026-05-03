export const PERIODS = [
  "today",
  "yesterday",
  "7d",
  "30d",
  "month",
  "all",
  "custom",
] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Este mês",
  all: "Tudo (histórico)",
  custom: "Personalizado",
};

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
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
): { since: Date | null; until: Date } {
  const now = new Date();
  switch (period) {
    case "today":
      return { since: startOfDay(now), until: now };
    case "yesterday": {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return { since: startOfDay(d), until: endOfDay(d) };
    }
    case "7d": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      const u = new Date(now);
      u.setDate(u.getDate() - 1);
      return { since: startOfDay(d), until: endOfDay(u) };
    }
    case "30d": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      const u = new Date(now);
      u.setDate(u.getDate() - 1);
      return { since: startOfDay(d), until: endOfDay(u) };
    }
    case "month": {
      const d = new Date(now);
      d.setDate(1);
      return { since: startOfDay(d), until: now };
    }
    case "custom": {
      if (!customDate) return { since: null, until: now };
      return { since: startOfDay(customDate), until: endOfDay(customDate) };
    }
    case "all":
    default:
      return { since: null, until: now };
  }
}
