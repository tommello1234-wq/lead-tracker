import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  HelpCircle,
  Users,
  CheckCircle2,
  TrendingDown,
  Sparkles,
  ExternalLink,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { StatCard } from "@/components/stat-card";
import { LeadDetailsModal } from "@/components/lead-details-modal";

type FunnelResponse = {
  lpUrl: string;
  totalSessions: number;
  completed: number;
  completionRate: number;
  avgLeadScore: number | null;
  steps: Array<{
    step: number;
    reached: number;
    answered: number;
    dropOffRate: number;
  }>;
};

type SessionRow = {
  id: string;
  persona: string | null;
  angulo: string | null;
  lpUrl: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  leadScore: number | null;
  email: string | null;
  startedAt: string;
  completedAt: string | null;
};

type AnswerRow = {
  id: number;
  sessionId: string;
  step: number;
  question: string;
  answer: string;
  answeredAt: string;
};

type LeadRow = {
  id: number;
  nome: string;
  email: string | null;
  contato: string | null;
  origem: string | null;
  observacoes: string | null;
  criadoEm: string;
};

const dateFmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function QuizPage() {
  const [lpUrl, setLpUrl] = useState("/quiz-criador-ia-v1");
  const [selectedSession, setSelectedSession] = useState<SessionRow | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);

  const funnel = useQuery({
    queryKey: ["quiz", "funnel", lpUrl],
    queryFn: () =>
      api.get<FunnelResponse>(`/api/quiz/funnel?lpUrl=${encodeURIComponent(lpUrl)}`),
  });

  const sessions = useQuery({
    queryKey: ["quiz", "sessions", lpUrl],
    queryFn: () =>
      api.get<SessionRow[]>(`/api/quiz/sessions?lpUrl=${encodeURIComponent(lpUrl)}`),
  });

  // Lista todas LP URLs disponíveis (das sessions existentes) pra dropdown
  const sessionsAll = useQuery({
    queryKey: ["quiz", "sessions", "all"],
    queryFn: () => api.get<SessionRow[]>(`/api/quiz/sessions`),
  });

  const lpUrls = useMemo(() => {
    const set = new Set<string>();
    for (const s of sessionsAll.data ?? []) {
      if (s.lpUrl) set.add(s.lpUrl);
    }
    return Array.from(set).sort();
  }, [sessionsAll.data]);

  // Leads criados via quiz (origem=quiz)
  const leads = useQuery({
    queryKey: ["leads", "quiz"],
    queryFn: () => api.get<LeadRow[]>(`/api/leads?origem=quiz&limit=50`),
  });

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Quiz analytics</h1>
          <p className="text-sm text-muted-foreground">
            Funnel de drop-off + leads capturados pelas LPs de quiz
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-muted-foreground">LP:</label>
          <select
            value={lpUrl}
            onChange={(e) => setLpUrl(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-card border border-border text-sm"
          >
            <option value="/quiz-criador-ia-v1">/quiz-criador-ia-v1 (atual)</option>
            {lpUrls
              .filter((u) => u !== "/quiz-criador-ia-v1")
              .map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Cards de overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Visitantes"
          value={funnel.data ? funnel.data.totalSessions.toLocaleString("pt-BR") : "—"}
          hint="Abriram o quiz"
          icon={Users}
          iconTone="lime"
        />
        <StatCard
          label="Completaram"
          value={funnel.data ? funnel.data.completed.toLocaleString("pt-BR") : "—"}
          hint={funnel.data ? `${funnel.data.completionRate.toFixed(1)}% de conversão` : undefined}
          icon={CheckCircle2}
          iconTone="forest"
        />
        <StatCard
          label="Lead score médio"
          value={funnel.data?.avgLeadScore ? funnel.data.avgLeadScore.toFixed(0) : "—"}
          hint="Afinidade com plano (0-100)"
          icon={Sparkles}
          iconTone="amber"
        />
        <StatCard
          label="Drop-off geral"
          value={
            funnel.data && funnel.data.totalSessions > 0
              ? `${(100 - funnel.data.completionRate).toFixed(1)}%`
              : "—"
          }
          hint="Abriram mas não completaram"
          icon={TrendingDown}
          iconTone="rose"
        />
      </div>

      {/* Funil visual */}
      <div className="bg-card border border-border rounded-2xl p-5">
        <h2 className="text-base font-semibold mb-1">Funil de drop-off</h2>
        <p className="text-xs text-muted-foreground mb-5">
          Mostra quantos visitantes chegaram em cada etapa
        </p>
        {funnel.isLoading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
        ) : !funnel.data || funnel.data.totalSessions === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Nenhuma sessão pra essa LP ainda.
          </p>
        ) : (
          <div className="space-y-2">
            <FunnelBar
              label="Visitantes (abriram quiz)"
              count={funnel.data.totalSessions}
              total={funnel.data.totalSessions}
              dropFromPrev={null}
            />
            {funnel.data.steps.map((s, i) => {
              const prevReached =
                i === 0 ? funnel.data!.totalSessions : funnel.data!.steps[i - 1].answered;
              const drop = prevReached - s.answered;
              return (
                <FunnelBar
                  key={s.step}
                  label={`Pergunta ${s.step}`}
                  count={s.answered}
                  total={funnel.data!.totalSessions}
                  dropFromPrev={drop}
                />
              );
            })}
            <FunnelBar
              label="Completaram (preencheram form)"
              count={funnel.data.completed}
              total={funnel.data.totalSessions}
              dropFromPrev={
                funnel.data.steps.length > 0
                  ? funnel.data.steps[funnel.data.steps.length - 1].answered -
                    funnel.data.completed
                  : null
              }
              highlight
            />
          </div>
        )}
      </div>

      {/* Sessions table */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-base font-semibold">Sessões ({sessions.data?.length ?? 0})</h2>
          <span className="text-xs text-muted-foreground">Click pra ver respostas</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2.5 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Quando
                </th>
                <th className="text-left px-3 py-2.5 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-3 py-2.5 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  UTM
                </th>
                <th className="text-left px-3 py-2.5 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Email
                </th>
                <th className="text-right px-4 py-2.5 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Score
                </th>
              </tr>
            </thead>
            <tbody>
              {sessions.isLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              ) : !sessions.data || sessions.data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    Sem sessões ainda
                  </td>
                </tr>
              ) : (
                sessions.data.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelectedSession(s)}
                    className="border-b border-border/40 last:border-b-0 hover:bg-muted/20 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 text-muted-foreground tabular-nums">
                      {fmtDate(s.startedAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      {s.completedAt ? (
                        <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                          completou
                        </span>
                      ) : (
                        <span className="text-[11px] uppercase font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-600 dark:text-amber-400">
                          abandonou
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground text-xs">
                      {s.utmSource ?? "—"}
                      {s.utmCampaign ? ` · ${s.utmCampaign}` : ""}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[180px]">
                      {s.email ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                      {s.leadScore != null ? s.leadScore : "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Leads criados via quiz */}
      <div className="bg-card border border-border rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold">
            Leads capturados pelo quiz ({leads.data?.length ?? 0})
          </h2>
          <p className="text-xs text-muted-foreground">
            Quem preencheu nome + WhatsApp no final do quiz
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/30">
              <tr className="border-b border-border">
                <th className="text-left px-4 py-2.5 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Nome
                </th>
                <th className="text-left px-3 py-2.5 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  WhatsApp
                </th>
                <th className="text-left px-3 py-2.5 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Email
                </th>
                <th className="text-left px-3 py-2.5 font-medium text-foreground/70 text-xs uppercase tracking-wider">
                  Quando
                </th>
              </tr>
            </thead>
            <tbody>
              {leads.isLoading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    Carregando...
                  </td>
                </tr>
              ) : !leads.data || leads.data.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">
                    Nenhum lead criado pelo quiz ainda
                  </td>
                </tr>
              ) : (
                leads.data.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => setSelectedLeadId(l.id)}
                    className="border-b border-border/40 last:border-b-0 hover:bg-muted/20 cursor-pointer"
                  >
                    <td className="px-4 py-2.5 font-medium truncate max-w-[200px]">
                      {l.nome}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                      {l.contato ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground truncate max-w-[200px]">
                      {l.email ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground tabular-nums">
                      {fmtDate(l.criadoEm)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de detalhes da sessão */}
      {selectedSession ? (
        <SessionDetailsModal
          session={selectedSession}
          onClose={() => setSelectedSession(null)}
        />
      ) : null}

      {/* Modal de detalhes do lead */}
      {selectedLeadId !== null ? (
        <LeadDetailsModal leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
      ) : null}
    </div>
  );
}

/* Barra horizontal do funil */
function FunnelBar({
  label,
  count,
  total,
  dropFromPrev,
  highlight,
}: {
  label: string;
  count: number;
  total: number;
  dropFromPrev: number | null;
  highlight?: boolean;
}) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-48 shrink-0 truncate text-foreground/80">{label}</div>
      <div className="flex-1 h-7 rounded-md bg-muted/30 overflow-hidden relative">
        <div
          className={`h-full transition-all ${
            highlight ? "bg-forest" : "bg-lime-soft"
          }`}
          style={{ width: `${pct}%` }}
        />
        <span
          className={`absolute inset-0 flex items-center px-2 text-xs font-medium tabular-nums ${
            pct > 50 && highlight ? "text-lime-soft" : "text-forest"
          }`}
        >
          {count} ({pct.toFixed(0)}%)
        </span>
      </div>
      <div className="w-20 shrink-0 text-right text-xs text-rose-600 dark:text-rose-400 tabular-nums">
        {dropFromPrev != null && dropFromPrev > 0 ? `−${dropFromPrev}` : ""}
      </div>
    </div>
  );
}

/* Modal: detalhes de 1 session com respostas */
function SessionDetailsModal({
  session,
  onClose,
}: {
  session: SessionRow;
  onClose: () => void;
}) {
  const answers = useQuery({
    queryKey: ["quiz", "answers", session.id],
    queryFn: () =>
      api.get<AnswerRow[]>(`/api/quiz/sessions/${session.id}/answers`),
  });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-4 bg-foreground/30 backdrop-blur-sm animate-in fade-in-0"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-3xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border">
          <div>
            <h2 className="text-lg font-semibold">Sessão {session.id.slice(0, 8)}</h2>
            <p className="text-xs text-muted-foreground">
              {fmtDate(session.startedAt)}
              {session.utmSource ? ` · UTM: ${session.utmSource}` : ""}
              {session.email ? ` · ${session.email}` : ""}
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
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {answers.isLoading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Carregando respostas...
            </p>
          ) : !answers.data || answers.data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Sem respostas registradas (visitante abandonou antes de responder)
            </p>
          ) : (
            answers.data.map((a) => (
              <div key={a.id} className="bg-muted/20 rounded-xl p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                  Pergunta {a.step}
                </div>
                <div className="font-medium mb-1">{a.question}</div>
                <div className="text-sm text-foreground/80">
                  Resposta: <span className="font-semibold">{a.answer}</span>
                </div>
              </div>
            ))
          )}
          {session.completedAt ? (
            <div className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 rounded-xl p-4 text-sm">
              <CheckCircle2 className="size-4 inline mr-2" />
              Completou o quiz em {fmtDate(session.completedAt)}
              {session.leadScore != null ? ` · score ${session.leadScore}` : ""}
            </div>
          ) : (
            <div className="bg-amber-500/10 text-amber-700 dark:text-amber-400 rounded-xl p-4 text-sm">
              <TrendingDown className="size-4 inline mr-2" />
              Visitante abandonou — não preencheu o form final
            </div>
          )}
        </div>
        <footer className="px-6 py-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>LP: {session.lpUrl ?? "—"}</span>
          {session.lpUrl ? (
            <a
              href={`https://gravyx.com.br${session.lpUrl}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-foreground hover:underline"
            >
              Abrir LP <ExternalLink className="size-3" />
            </a>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
