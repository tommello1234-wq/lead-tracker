import type { ReactNode } from "react";

/**
 * Hero card escuro forest — banner principal do dashboard.
 * Inspirado no card "Andrew Forbist Balance" do COINEST.
 */
export function HeroCard({
  greeting,
  title,
  hint,
  primaryStat,
  primaryLabel,
  topRight,
  decoration,
}: {
  greeting?: string;
  title: string;
  hint?: string;
  primaryStat?: string;
  primaryLabel?: string;
  topRight?: ReactNode;
  decoration?: ReactNode;
}) {
  return (
    <section className="card-forest relative overflow-hidden p-8 sm:p-10">
      {/* Decoração canto superior direito (linhas onduladas no ref do COINEST) */}
      <div className="absolute top-0 right-0 opacity-15 pointer-events-none">
        {decoration ?? <DefaultDecoration />}
      </div>

      <div className="relative flex items-end justify-between gap-6 flex-wrap">
        <div className="min-w-0 flex-1">
          {greeting ? (
            <p className="text-sm text-[oklch(0.96_0.04_130)]/60 mb-1">{greeting}</p>
          ) : null}
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-[oklch(0.96_0.04_130)]">
            {title}
          </h1>
          {hint ? (
            <p className="text-sm text-[oklch(0.96_0.04_130)]/70 mt-1.5">{hint}</p>
          ) : null}
          {primaryStat ? (
            <div className="mt-6">
              {primaryLabel ? (
                <p className="text-xs uppercase tracking-wider text-[oklch(0.96_0.04_130)]/55 mb-1">
                  {primaryLabel}
                </p>
              ) : null}
              <p className="text-4xl sm:text-5xl font-bold tabular-nums text-[oklch(0.86_0.18_130)]">
                {primaryStat}
              </p>
            </div>
          ) : null}
        </div>
        {topRight ? <div className="shrink-0">{topRight}</div> : null}
      </div>
    </section>
  );
}

function DefaultDecoration() {
  return (
    <svg width="200" height="200" viewBox="0 0 200 200" fill="none">
      {[1, 2, 3, 4, 5].map((i) => (
        <circle
          key={i}
          cx="200"
          cy="0"
          r={40 + i * 20}
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
      ))}
    </svg>
  );
}
