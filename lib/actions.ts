"use server";

import { db } from "@/db/client";
import {
  leads,
  LEAD_TYPES,
  LEAD_STATUS,
  LEAD_ORIGINS,
  type LeadOrigin,
  type LeadStatus,
  type LeadType,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

function readForm(formData: FormData) {
  const get = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };

  const tipo = get("tipo") as LeadType | null;
  const status = (get("status") ?? "novo") as LeadStatus;
  const origem = get("origem") as LeadOrigin | null;
  const valorRaw = get("valorEstimado");

  if (!tipo || !LEAD_TYPES.includes(tipo)) throw new Error("Tipo invalido");
  if (!LEAD_STATUS.includes(status)) throw new Error("Status invalido");
  if (origem && !LEAD_ORIGINS.includes(origem)) throw new Error("Origem invalida");

  const nome = get("nome");
  if (!nome) throw new Error("Nome obrigatorio");

  return {
    nome,
    contato: get("contato"),
    tipo,
    status,
    origem,
    valorEstimado: valorRaw ? Number(valorRaw.replace(",", ".")) : null,
    observacoes: get("observacoes"),
  };
}

function timestampsForStatus(status: LeadStatus, now: Date) {
  return {
    primeiroContatoEm:
      status !== "novo" ? now : null,
    respondeuEm:
      status === "respondeu" || status === "convertido" || status === "reembolso_revertido"
        ? now
        : null,
    convertidoEm:
      status === "convertido" || status === "reembolso_revertido" ? now : null,
  };
}

export async function createLead(formData: FormData) {
  const data = readForm(formData);
  const now = new Date();
  const ts = timestampsForStatus(data.status, now);

  await db.insert(leads).values({
    ...data,
    ...ts,
    criadoEm: now,
    atualizadoEm: now,
  });

  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function updateLead(id: number, formData: FormData) {
  const data = readForm(formData);
  const now = new Date();

  const existing = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  const prev = existing[0];
  if (!prev) throw new Error("Lead nao encontrado");

  const updates: Record<string, unknown> = {
    ...data,
    atualizadoEm: now,
  };

  if (data.status !== prev.status) {
    if (data.status !== "novo" && !prev.primeiroContatoEm) {
      updates.primeiroContatoEm = now;
    }
    if (
      (data.status === "respondeu" ||
        data.status === "convertido" ||
        data.status === "reembolso_revertido") &&
      !prev.respondeuEm
    ) {
      updates.respondeuEm = now;
    }
    if (
      (data.status === "convertido" || data.status === "reembolso_revertido") &&
      !prev.convertidoEm
    ) {
      updates.convertidoEm = now;
    }
  }

  await db.update(leads).set(updates).where(eq(leads.id, id));

  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function deleteLead(id: number) {
  await db.delete(leads).where(eq(leads.id, id));
  revalidatePath("/leads");
  revalidatePath("/dashboard");
}

export async function quickStatusChange(id: number, status: LeadStatus) {
  if (!LEAD_STATUS.includes(status)) throw new Error("Status invalido");
  const now = new Date();

  const existing = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
  const prev = existing[0];
  if (!prev) throw new Error("Lead nao encontrado");

  const updates: Record<string, unknown> = {
    status,
    atualizadoEm: now,
  };

  if (status !== "novo" && !prev.primeiroContatoEm) updates.primeiroContatoEm = now;
  if (
    (status === "respondeu" || status === "convertido" || status === "reembolso_revertido") &&
    !prev.respondeuEm
  ) {
    updates.respondeuEm = now;
  }
  if (
    (status === "convertido" || status === "reembolso_revertido") &&
    !prev.convertidoEm
  ) {
    updates.convertidoEm = now;
  }

  await db.update(leads).set(updates).where(eq(leads.id, id));

  revalidatePath("/leads");
  revalidatePath("/dashboard");
}
