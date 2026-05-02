import { AppSidebar } from "@/components/app-sidebar";
import { getSidebarCounts } from "@/lib/queries";
import { getSelectedProdutoId } from "@/lib/produto-context";
import { db } from "@/db/client";
import { produtos as produtosTable } from "@/db/schema";
import { asc, eq } from "drizzle-orm";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [counts, produtos, selectedProdutoId] = await Promise.all([
    getSidebarCounts(),
    db
      .select()
      .from(produtosTable)
      .where(eq(produtosTable.ativo, true))
      .orderBy(asc(produtosTable.id)),
    getSelectedProdutoId(),
  ]);

  return (
    <div className="flex flex-1 min-h-screen bg-background gap-3 p-3">
      <AppSidebar
        counts={counts}
        produtos={produtos}
        selectedProdutoId={selectedProdutoId}
      />
      <main className="flex-1 min-w-0 px-2 py-4 sm:px-6 lg:px-8 overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
