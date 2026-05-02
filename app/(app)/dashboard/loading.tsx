export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <section className="rounded-3xl bg-sidebar/20 h-32" />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-3xl bg-card h-36 border-0 shadow-sm" />
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-3xl bg-card h-36 border-0 shadow-sm" />
        ))}
      </div>
    </div>
  );
}
