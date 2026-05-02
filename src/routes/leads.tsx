import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useProdutoContext } from "@/contexts/produto-context";

type Lead = {
  id: number;
  nome: string;
  contato: string | null;
  status: string;
  valorAssinatura: number | null;
  criadoEm: string;
};

export function LeadsPage() {
  const { produtoId } = useProdutoContext();
  const produtoParam = produtoId ?? "all";

  const { data, isLoading, error } = useQuery({
    queryKey: ["leads", produtoParam],
    queryFn: () => api.get<Lead[]>(`/api/leads?produtoId=${produtoParam}`),
  });

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Leads</h1>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : error ? (
        <p className="text-sm text-destructive">
          Erro: {error instanceof Error ? error.message : "?"}
        </p>
      ) : (
        <div className="rounded-3xl border border-border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Nome</th>
                <th className="text-left px-4 py-3 font-medium">Contato</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Valor</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="px-4 py-3">{l.nome}</td>
                  <td className="px-4 py-3 text-muted-foreground">{l.contato ?? "—"}</td>
                  <td className="px-4 py-3">{l.status}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {l.valorAssinatura
                      ? l.valorAssinatura.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        UI completa (filtros, edição inline, drag&drop de status) vem na próxima iteração.
      </p>
    </div>
  );
}
