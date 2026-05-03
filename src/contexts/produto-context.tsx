import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { PERIODS, type Period } from "@/lib/period";

const PRODUTO_KEY = "lt-produto-id";
const PERIOD_KEY = "lt-period";
const CUSTOM_DATE_KEY = "lt-period-custom-date";

type Ctx = {
  produtoId: number | null;
  setProdutoId: (id: number | null) => void;
  period: Period;
  setPeriod: (p: Period) => void;
  /** Dia escolhido quando period === "custom". Null caso contrário. */
  customDate: Date | null;
  setCustomDate: (d: Date | null) => void;
};

const ProdutoContext = createContext<Ctx | null>(null);

export function ProdutoProvider({ children }: { children: ReactNode }) {
  const [produtoId, setProdutoIdState] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const v = localStorage.getItem(PRODUTO_KEY);
    if (!v || v === "all") return null;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : null;
  });

  const [period, setPeriodState] = useState<Period>(() => {
    if (typeof window === "undefined") return "30d";
    const v = localStorage.getItem(PERIOD_KEY) as Period | null;
    return v && (PERIODS as readonly string[]).includes(v) ? v : "30d";
  });

  const [customDate, setCustomDateState] = useState<Date | null>(() => {
    if (typeof window === "undefined") return null;
    const v = localStorage.getItem(CUSTOM_DATE_KEY);
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  });

  useEffect(() => {
    localStorage.setItem(PRODUTO_KEY, produtoId == null ? "all" : String(produtoId));
  }, [produtoId]);

  useEffect(() => {
    localStorage.setItem(PERIOD_KEY, period);
  }, [period]);

  useEffect(() => {
    if (customDate) {
      localStorage.setItem(CUSTOM_DATE_KEY, customDate.toISOString());
    } else {
      localStorage.removeItem(CUSTOM_DATE_KEY);
    }
  }, [customDate]);

  const value = useMemo(
    () => ({
      produtoId,
      setProdutoId: setProdutoIdState,
      period,
      setPeriod: setPeriodState,
      customDate,
      setCustomDate: setCustomDateState,
    }),
    [produtoId, period, customDate],
  );

  return <ProdutoContext.Provider value={value}>{children}</ProdutoContext.Provider>;
}

export function useProdutoContext() {
  const ctx = useContext(ProdutoContext);
  if (!ctx) throw new Error("useProdutoContext deve ser usado dentro de ProdutoProvider");
  return ctx;
}
