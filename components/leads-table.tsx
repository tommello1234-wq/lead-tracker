"use client";

import { useState, useMemo, useTransition } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LEAD_STATUS, LEAD_TYPES, type Lead, type LeadStatus } from "@/db/schema";
import { TIPO_LABEL, STATUS_LABEL, STATUS_COLOR, ORIGEM_LABEL } from "@/lib/labels";
import { LeadForm } from "@/components/lead-form";
import { deleteLead, quickStatusChange } from "@/lib/actions";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Trash2, Plus } from "lucide-react";

type Props = { leads: Lead[] };

export function LeadsTable({ leads }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [tipoFilter, setTipoFilter] = useState<string>("all");
  const [editing, setEditing] = useState<Lead | null>(null);
  const [creating, setCreating] = useState(false);
  const [, startTransition] = useTransition();

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      if (statusFilter !== "all" && l.status !== statusFilter) return false;
      if (tipoFilter !== "all" && l.tipo !== tipoFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${l.nome} ${l.contato ?? ""} ${l.observacoes ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, search, statusFilter, tipoFilter]);

  function handleStatusChange(id: number, status: LeadStatus) {
    startTransition(async () => {
      try {
        await quickStatusChange(id, status);
        toast.success(`Status atualizado: ${STATUS_LABEL[status]}`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  function handleDelete(id: number) {
    if (!confirm("Deletar este lead?")) return;
    startTransition(async () => {
      try {
        await deleteLead(id);
        toast.success("Lead removido.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Buscar por nome, contato, observacao..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v ?? "all")}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {LEAD_STATUS.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tipoFilter} onValueChange={(v) => setTipoFilter(v ?? "all")}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Tipo" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tipos</SelectItem>
            {LEAD_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TIPO_LABEL[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {filtered.length} de {leads.length}
          </span>
          <Button onClick={() => setCreating(true)} className="gap-2">
            <Plus className="size-4" /> Novo lead
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Contato</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Criado</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                  Nenhum lead encontrado.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">
                    <button
                      type="button"
                      className="text-left hover:underline"
                      onClick={() => setEditing(l)}
                    >
                      {l.nome}
                    </button>
                    {l.observacoes ? (
                      <div className="text-xs text-muted-foreground truncate max-w-[260px]">
                        {l.observacoes}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>{TIPO_LABEL[l.tipo]}</TableCell>
                  <TableCell>
                    <Badge className={STATUS_COLOR[l.status]} variant="secondary">
                      {STATUS_LABEL[l.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>{l.origem ? ORIGEM_LABEL[l.origem] : "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {l.contato ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {l.valorEstimado != null
                      ? l.valorEstimado.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(l.criadoEm).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setEditing(l)}>
                          <Pencil className="size-4" /> Editar
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel>Mudar status</DropdownMenuLabel>
                        {LEAD_STATUS.filter((s) => s !== l.status).map((s) => (
                          <DropdownMenuItem
                            key={s}
                            onClick={() => handleStatusChange(l.id, s)}
                          >
                            {STATUS_LABEL[s]}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleDelete(l.id)}
                          className="text-red-600"
                        >
                          <Trash2 className="size-4" /> Deletar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <LeadForm open={creating} onOpenChange={setCreating} />
      <LeadForm
        open={editing !== null}
        onOpenChange={(v) => !v && setEditing(null)}
        lead={editing}
      />
    </div>
  );
}
