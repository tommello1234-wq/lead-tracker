export default function LeadsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-8 w-32 bg-card rounded-md" />
        <div className="h-4 w-64 bg-card/60 rounded-md mt-2" />
      </div>
      <div className="rounded-3xl bg-card h-96 border-0 shadow-sm" />
    </div>
  );
}
