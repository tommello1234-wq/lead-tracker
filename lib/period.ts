export const PERIODS = ["today", "7d", "30d", "month", "all"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  today: "Hoje",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  month: "Este mês",
  all: "Tudo (histórico)",
};

/**
 * Resolve o período em uma `since: Date | null` (null = sem filtro).
 */
export function periodToSince(period: Period): Date | null {
  const now = new Date();
  const startOfDay = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
  };
  switch (period) {
    case "today":
      return startOfDay(now);
    case "7d": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return startOfDay(d);
    }
    case "30d": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return startOfDay(d);
    }
    case "month": {
      const d = new Date(now);
      d.setDate(1);
      return startOfDay(d);
    }
    case "all":
    default:
      return null;
  }
}
