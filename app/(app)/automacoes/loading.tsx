export default function AutomacoesLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <section className="rounded-3xl bg-sidebar/20 h-28" />
      <div>
        <div className="h-5 w-40 bg-card rounded-md mb-3" />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-card h-64 border-0 shadow-sm" />
          ))}
        </div>
      </div>
      <div>
        <div className="h-5 w-32 bg-card rounded-md mb-3" />
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-2xl bg-card h-44 border-0 shadow-sm" />
          ))}
        </div>
      </div>
    </div>
  );
}
