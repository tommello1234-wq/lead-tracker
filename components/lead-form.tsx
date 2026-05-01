"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { LEAD_TYPES, LEAD_STATUS, LEAD_ORIGINS, type Lead } from "@/db/schema";
import { TIPO_LABEL, STATUS_LABEL, ORIGEM_LABEL } from "@/lib/labels";
import { createLead, updateLead } from "@/lib/actions";
import { toast } from "sonner";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead?: Lead | null;
};

export function LeadForm({ open, onOpenChange, lead }: Props) {
  const [pending, startTransition] = useTransition();
  const [tipo, setTipo] = useState(lead?.tipo ?? "abandono_carrinho");
  const [status, setStatus] = useState(lead?.status ?? "novo");
  const [origem, setOrigem] = useState(lead?.origem ?? "");

  const isEdit = Boolean(lead);

  function handleSubmit(formData: FormData) {
    formData.set("tipo", tipo);
    formData.set("status", status);
    if (origem) formData.set("origem", origem);

    startTransition(async () => {
      try {
        if (isEdit && lead) {
          await updateLead(lead.id, formData);
          toast.success("Lead atualizado.");
        } else {
          await createLead(formData);
          toast.success("Lead cadastrado.");
        }
        onOpenChange(false);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erro ao salvar lead.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar lead" : "Novo lead"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Atualize informacoes e o status do lead."
              : "Cadastre um novo lead no sistema."}
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="nome">Nome *</Label>
            <Input id="nome" name="nome" required defaultValue={lead?.nome ?? ""} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="contato">Contato (telefone / email)</Label>
              <Input id="contato" name="contato" defaultValue={lead?.contato ?? ""} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="valorEstimado">Valor estimado (R$)</Label>
              <Input
                id="valorEstimado"
                name="valorEstimado"
                type="number"
                step="0.01"
                defaultValue={lead?.valorEstimado ?? ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label>Tipo *</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as typeof tipo)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPO_LABEL[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEAD_STATUS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2">
            <Label>Origem</Label>
            <Select value={origem} onValueChange={(v) => setOrigem(v ?? "")}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione (opcional)" />
              </SelectTrigger>
              <SelectContent>
                {LEAD_ORIGINS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {ORIGEM_LABEL[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="observacoes">Observacoes</Label>
            <Textarea
              id="observacoes"
              name="observacoes"
              rows={3}
              defaultValue={lead?.observacoes ?? ""}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando..." : isEdit ? "Atualizar" : "Cadastrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
