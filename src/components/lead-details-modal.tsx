import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  X,
  AlertCircle,
  User,
  Mail,
  Phone,
  CreditCard,
  Calendar,
  TrendingUp,
  MessageSquare,
  Activity,
} from "lucide-react";
import { api } from "@/lib/api";

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
const brlSigned = (n: number) => (n >= 0 ? `+${brl(n)}` : `−${brl(Math.abs(n))}`);

const dateTimeFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
function formatDt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

type LeadDetails = {
  lead: {
    id: number;
    nome: string;
    contato: string | null;
    email: string | null;
    status: string;
    subscriptionStatus: string;
    planoNome: string | null;
    valorAssinatura: number | null;
    periodicidade: string;
    gateway: string | null;
    gatewayCustomerId: string | null;
    gatewayLastOrderId: string | null;
    pagouEm: string | null;
    canceladoEm: string | null;
    respondeuEm: string | null;
    pixGeradoEm: string | null;
    pixExpiraEm: string | null;
    ultimaRenovacaoEm: string | null;
    criadoEm: string;
    atualizadoEm: string;
  };
  produto: { id: number; nome: string } | null;
  eventos: Array<{
    id: number;
    source: string;
    eventType: string;
    processedOk: boolean;
    erro: string | null;
    receivedAt: string;
  }>;
  mensagens: Array<{
    id: number;
    template: string;
    conteudo: string;
    status: string;
    erro: string | null;
    agendadoPara: string;
    enviadoEm: string | null;
    criadoEm: string;
  }>;
  movements: Array<{
    id: number;
    type: string;
    amount: number;
    fromValue: number | null;
    toValue: number | null;
    fromPlano: string | null;
    toPlano: string | null;
    ocorridoEm: string;
  }>;
};

const STATUS_CLASS: Record<string, string> = {
  cliente_ativo: "bg-forest/10 text-forest",
  cliente_em_risco: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  cliente_cancelado: "bg-destructive/10 text-destructive",
  reembolso_revertido: "bg-destructive/10 text-destructive",
  pix_gerado: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  pix_expirado: "bg-muted text-muted-foreground",
  carrinho_abandonado: "bg-muted text-muted-foreground",
  lead_novo: "bg-muted text-muted-foreground",
};

const MOV_COLOR: Record<string, string> = {
  new: "text-forest",
  expansion: "text-forest",
  reactivation: "text-forest",
  contraction: "text-amber-600",
  churn: "text-destructive",
  refund: "text-destructive",
};

export function LeadDetailsModal({
  leadId,
  onClose,
}: {
  leadId: number;
  onClose: () => void;
}) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["leads", "details", leadId],
    queryFn: () => api.get<LeadDetails>(`/api/leads/${leadId}/details`),
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-foreground/30 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate">
              {data?.lead?.nome ?? "Carregando..."}
            </h2>
            <p className="text-xs text-muted-foreground">
              Lead #{leadId}
              {data?.produto ? ` · ${data.produto.nome}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="size-9 rounded-xl hover:bg-muted/40 grid place-items-center transition-colors"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Carregando...</p>
          ) : isError ? (
            <div className="py-12 px-6 text-center">
              <AlertCircle className="size-8 text-destructive mx-auto mb-3" />
              <p className="text-sm font-medium text-destructive mb-1">Erro ao carregar</p>
              <p className="text-xs text-muted-foreground">
                {error instanceof Error ? error.message : "Erro desconhecido"}
              </p>
            </div>
          ) : !data ? (
            <p className="text-sm text-muted-foreground py-12 text-center">Sem dados</p>
          ) : (
            <div className="p-6 space-y-6">
              {/* Status badges + dados gerais */}
              <section>
                <div className="flex flex-wrap gap-2 mb-4">
                  <span
                    className={`px-2 py-1 rounded-md text-xs font-medium ${
                      STATUS_CLASS[data.lead.status] ?? "bg-muted text-muted-foreground"
                    }`}
                  >
                    {data.lead.status.replace(/_/g, " ")}
                  </span>
                  <span
                    className={`px-2 py-1 rounded-md text-xs font-medium ${
                      data.lead.subscriptionStatus === "ativa"
                        ? "bg-forest/10 text-forest"
                        : data.lead.subscriptionStatus === "atrasada"
                          ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                          : "bg-muted text-muted-foreground"
                    }`}
                  >
                    sub: {data.lead.subscriptionStatus}
                  </span>
                  {data.lead.gateway ? (
                    <span
                      className={`px-2 py-1 rounded-md text-xs font-medium uppercase tracking-wider ${
                        data.lead.gateway === "ticto"
                          ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                          : data.lead.gateway === "asaas"
                            ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
                            : data.lead.gateway === "stripe"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {data.lead.gateway}
                    </span>
                  ) : null}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <Field icon={Mail} label="Email" value={data.lead.email} />
                  <Field icon={Phone} label="Contato" value={data.lead.contato} />
                  <Field
                    icon={CreditCard}
                    label="Plano"
                    value={
                      data.lead.planoNome
                        ? `${data.lead.planoNome}${
                            data.lead.valorAssinatura
                              ? ` · ${brl(data.lead.valorAssinatura)} (${data.lead.periodicidade})`
                              : ""
                          }`
                        : null
                    }
                  />
                  <Field icon={User} label="CPF/CNPJ" value={data.lead.gatewayCustomerId} />
                  <Field icon={Calendar} label="Criado" value={formatDt(data.lead.criadoEm)} />
                  <Field icon={Calendar} label="Pagou" value={formatDt(data.lead.pagouEm)} />
                  {data.lead.canceladoEm ? (
                    <Field icon={Calendar} label="Cancelou" value={formatDt(data.lead.canceladoEm)} />
                  ) : null}
                  {data.lead.respondeuEm ? (
                    <Field icon={MessageSquare} label="Respondeu WhatsApp" value={formatDt(data.lead.respondeuEm)} />
                  ) : null}
                </div>
              </section>

              {/* MRR Movements */}
              {data.movements.length > 0 ? (
                <section>
                  <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <TrendingUp className="size-4" />
                    Movimentações de MRR ({data.movements.length})
                  </h3>
                  <div className="border border-border/50 rounded-xl divide-y divide-border/30">
                    {data.movements.map((m) => (
                      <div key={m.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                        <span
                          className={`uppercase text-xs font-medium tracking-wider px-2 py-0.5 rounded-md ${
                            MOV_COLOR[m.type] ?? "text-foreground"
                          }`}
                        >
                          {m.type}
                        </span>
                        <span className={`tabular-nums font-semibold ${MOV_COLOR[m.type] ?? ""}`}>
                          {brlSigned(m.amount)}
                        </span>
                        {m.fromPlano || m.toPlano ? (
                          <span className="text-muted-foreground text-xs flex-1 truncate">
                            {m.fromPlano ?? "—"} → {m.toPlano ?? "—"}
                          </span>
                        ) : (
                          <span className="flex-1" />
                        )}
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {formatDt(m.ocorridoEm)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Mensagens */}
              {data.mensagens.length > 0 ? (
                <section>
                  <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                    <MessageSquare className="size-4" />
                    Mensagens ({data.mensagens.length})
                  </h3>
                  <div className="border border-border/50 rounded-xl divide-y divide-border/30">
                    {data.mensagens.map((m) => (
                      <div key={m.id} className="px-3 py-2 text-sm">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-xs uppercase tracking-wider">
                            {m.template}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              m.status === "sent"
                                ? "bg-forest/10 text-forest"
                                : m.status === "skipped"
                                  ? "bg-muted text-muted-foreground"
                                  : m.status === "failed"
                                    ? "bg-destructive/10 text-destructive"
                                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {m.status}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                            {formatDt(m.enviadoEm ?? m.criadoEm)}
                          </span>
                        </div>
                        {m.erro ? (
                          <p className="text-xs text-destructive mt-1">{m.erro}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {m.conteudo}
                        </p>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {/* Eventos */}
              <section>
                <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
                  <Activity className="size-4" />
                  Eventos do gateway ({data.eventos.length})
                </h3>
                <div className="border border-border/50 rounded-xl divide-y divide-border/30">
                  {data.eventos.length === 0 ? (
                    <p className="text-sm text-muted-foreground p-3">Sem eventos.</p>
                  ) : (
                    data.eventos.map((e) => (
                      <div key={e.id} className="px-3 py-2 text-sm flex items-center gap-3">
                        <span className="text-xs uppercase font-medium tracking-wider text-muted-foreground min-w-[60px]">
                          {e.source}
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            !e.processedOk || e.erro ? "text-muted-foreground" : ""
                          }`}
                        >
                          {e.eventType}
                        </span>
                        {e.erro ? (
                          <span className="text-xs text-muted-foreground italic truncate">
                            ({e.erro})
                          </span>
                        ) : null}
                        <span className="text-xs text-muted-foreground tabular-nums ml-auto">
                          {formatDt(e.receivedAt)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof User;
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="size-4 text-muted-foreground shrink-0 mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-medium truncate">{value ?? "—"}</p>
      </div>
    </div>
  );
}
