import { useState } from "react";
import { ChevronDown, Check, CreditCard } from "lucide-react";
import { useGateway, type GatewayFilter } from "@/contexts/produto-context";

type GatewayOption = {
  id: GatewayFilter;
  label: string;
  hint: string;
  dot: string; // tailwind bg-* class
};

const OPTIONS: GatewayOption[] = [
  { id: "stripe", label: "Stripe", hint: "LP V2 · pago atual", dot: "bg-amber-500" },
  { id: "ticto", label: "Ticto", hint: "Legado · base ativa", dot: "bg-blue-500" },
  { id: "asaas", label: "Asaas", hint: "Legado · webhook off", dot: "bg-violet-500" },
  { id: "pagarme", label: "Pagar.me", hint: "Marginal", dot: "bg-emerald-500" },
];

export function GatewaySwitcher() {
  const [open, setOpen] = useState(false);
  const { gateway, setGateway } = useGateway();

  const selected = OPTIONS.find((o) => o.id === gateway) ?? null;
  const label = selected?.label ?? "Todos os gateways";

  function pick(id: GatewayFilter) {
    setGateway(id);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-card border border-border text-foreground text-sm font-medium hover:border-foreground/20 transition-colors"
      >
        {selected ? (
          <span className={`size-3 rounded-full shrink-0 ${selected.dot}`} />
        ) : (
          <CreditCard className="size-4 text-foreground/70" />
        )}
        <span className="max-w-[140px] truncate">{label}</span>
        <ChevronDown
          className={`size-4 text-foreground/60 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute z-40 right-0 top-full mt-2 min-w-[240px] rounded-2xl border bg-popover shadow-lg p-1.5 animate-in fade-in-0 zoom-in-95">
            <DropdownItem
              active={gateway == null}
              onClick={() => pick(null)}
              icon={<CreditCard className="size-3.5" />}
              label="Todos os gateways"
              hint="Visão consolidada"
            />
            <div className="my-1 border-t border-border" />
            {OPTIONS.map((o) => (
              <DropdownItem
                key={o.id ?? "none"}
                active={gateway === o.id}
                onClick={() => pick(o.id)}
                icon={<span className={`size-3 rounded-full ${o.dot}`} />}
                label={o.label}
                hint={o.hint}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

function DropdownItem({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-left transition-colors ${
        active ? "bg-secondary" : "hover:bg-muted"
      }`}
    >
      <span className="size-7 rounded-lg bg-muted/40 grid place-items-center shrink-0">
        {icon}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-medium truncate">{label}</span>
        {hint ? (
          <span className="block text-xs text-muted-foreground truncate">{hint}</span>
        ) : null}
      </span>
      {active ? <Check className="size-4 text-foreground/70 shrink-0" /> : null}
    </button>
  );
}
