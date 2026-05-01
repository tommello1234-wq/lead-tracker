import { LeadsTable } from "@/components/leads-table";
import { getAllLeads } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const leads = await getAllLeads();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
        <p className="text-muted-foreground">
          Cadastre, edite e acompanhe o status de todos os seus leads.
        </p>
      </div>
      <LeadsTable leads={leads} />
    </div>
  );
}
