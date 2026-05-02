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

type Ctx = {
  produtoId: number | null;
  setProdutoId: (id: number | null) => void;
  period: Period;
  setPeriod: (p: Period) => void;
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

  useEffect(() => {
    localStorage.setItem(PRODUTO_KEY, produtoId == null ? "all" : String(produtoId));
  }, [produtoId]);

  useEffect(() => {
    localStorage.setItem(PERIOD_KEY, period);
  }, [period]);

  const value = useMemo(
    () => ({
      produtoId,
      setProdutoId: setProdutoIdState,
      period,
      setPeriod: setPeriodState,
    }),
    [produtoId, period],
  );

  return <ProdutoContext.Provider value={value}>{children}</ProdutoContext.Provider>;
}

export function useProdutoContext() {
  const ctx = useContext(ProdutoContext);
  if (!ctx) throw new Error("useProdutoContext deve ser usado dentro de ProdutoProvider");
  return ctx;
}
