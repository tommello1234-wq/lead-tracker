"use server";

import { db } from "@/db/client";
import { messageTemplates, flowSteps, type MessageTemplate } from "@/db/schema";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

export async function updateTemplateAction(formData: FormData) {
  const key = String(formData.get("key") ?? "") as MessageTemplate;
  const conteudo = String(formData.get("conteudo") ?? "").trim();

  if (!key) throw new Error("Template key obrigatório");
  if (!conteudo) throw new Error("Conteúdo não pode ser vazio");
  if (conteudo.length > 4000) throw new Error("Conteúdo muito longo (>4000 chars)");

  await db
    .update(messageTemplates)
    .set({ conteudo, atualizadoEm: new Date() })
    .where(eq(messageTemplates.key, key));

  revalidatePath("/automacoes");
  return { ok: true };
}

export async function revertTemplateAction(formData: FormData) {
  const key = String(formData.get("key") ?? "") as MessageTemplate;
  if (!key) throw new Error("Template key obrigatório");

  const tpl = await db.query.messageTemplates.findFirst({
    where: eq(messageTemplates.key, key),
  });
  if (!tpl) throw new Error(`Template ${key} não encontrado`);

  await db
    .update(messageTemplates)
    .set({ conteudo: tpl.conteudoDefault, atualizadoEm: new Date() })
    .where(eq(messageTemplates.key, key));

  revalidatePath("/automacoes");
  return { ok: true };
}

export async function updateFlowStepAction(formData: FormData) {
  const id = Number(formData.get("id"));
  const delayValue = Number(formData.get("delayValue"));
  const delayUnit = String(formData.get("delayUnit") ?? "minutes");
  const ativo = formData.get("ativo") === "on";
  const cancelPrevious = formData.get("cancelPrevious") === "on";

  if (!Number.isInteger(id) || id <= 0) throw new Error("ID inválido");
  if (!Number.isFinite(delayValue) || delayValue < 0) throw new Error("Delay inválido");

  const multipliers: Record<string, number> = {
    seconds: 1,
    minutes: 60,
    hours: 60 * 60,
    days: 60 * 60 * 24,
  };
  const multiplier = multipliers[delayUnit];
  if (!multiplier) throw new Error("Unidade de delay inválida");

  const delaySeconds = Math.floor(delayValue * multiplier);
  if (delaySeconds > 60 * 60 * 24 * 30) throw new Error("Delay máximo: 30 dias");

  await db
    .update(flowSteps)
    .set({ delaySeconds, ativo, cancelPrevious, atualizadoEm: new Date() })
    .where(eq(flowSteps.id, id));

  revalidatePath("/automacoes");
  return { ok: true };
}

/**
 * Adiciona um novo passo ao fluxo de um gateway_event.
 * Auto-calcula a próxima `ordem`.
 */
export async function addFlowStepAction(formData: FormData) {
  const templateKey = String(formData.get("templateKey") ?? "");
  const gatewayEvent = String(formData.get("gatewayEvent") ?? "");
  const delayValue = Number(formData.get("delayValue"));
  const delayUnit = String(formData.get("delayUnit") ?? "hours");

  if (!templateKey) throw new Error("Template obrigatório");
  if (!gatewayEvent) throw new Error("Evento obrigatório");
  if (!Number.isFinite(delayValue) || delayValue < 0) throw new Error("Delay inválido");

  const multipliers: Record<string, number> = {
    seconds: 1,
    minutes: 60,
    hours: 60 * 60,
    days: 60 * 60 * 24,
  };
  const multiplier = multipliers[delayUnit];
  if (!multiplier) throw new Error("Unidade inválida");

  const delaySeconds = Math.floor(delayValue * multiplier);
  if (delaySeconds > 60 * 60 * 24 * 30) throw new Error("Delay máximo: 30 dias");

  // Limite: máximo 5 passos por evento (UX cap, evita spam)
  const existing = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.gatewayEvent, gatewayEvent));
  if (existing.length >= 5) {
    throw new Error("Máximo de 5 passos por fluxo");
  }

  const maxOrdem = existing.reduce((m, s) => (s.ordem > m ? s.ordem : m), 0);

  await db.insert(flowSteps).values({
    gatewayEvent,
    ordem: maxOrdem + 1,
    templateKey: templateKey as MessageTemplate,
    delaySeconds,
    ativo: true,
    cancelPrevious: false,
  });

  revalidatePath("/automacoes");
  return { ok: true };
}

export async function deleteFlowStepAction(formData: FormData) {
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) throw new Error("ID inválido");

  await db.delete(flowSteps).where(eq(flowSteps.id, id));

  revalidatePath("/automacoes");
  return { ok: true };
}

/**
 * Cria um template novo. Gera `key` automaticamente do nome.
 * O `gatewayEvent` é opcional — se passado, já cria um flow_step inicial.
 */
export async function createTemplateAction(formData: FormData) {
  const nome = String(formData.get("nome") ?? "").trim();
  const descricao = String(formData.get("descricao") ?? "").trim() || null;
  const conteudo = String(formData.get("conteudo") ?? "").trim();
  const gatewayEvent = String(formData.get("gatewayEvent") ?? "").trim();

  if (!nome) throw new Error("Nome obrigatório");
  if (!conteudo) throw new Error("Conteúdo obrigatório");
  if (conteudo.length > 4000) throw new Error("Conteúdo muito longo");

  // Gera key normalizada
  const key = nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 40);

  if (!key) throw new Error("Não foi possível gerar key do nome");

  // Verifica unicidade
  const existing = await db.query.messageTemplates.findFirst({
    where: eq(messageTemplates.key, key as never),
  });
  if (existing) throw new Error(`Já existe um template com key "${key}"`);

  await db.insert(messageTemplates).values({
    key: key as never,
    nome,
    descricao,
    conteudo,
    conteudoDefault: conteudo,
    placeholdersDisponiveis: ["primeiroNome", "nome", "valor"],
  });

  // Se gatewayEvent foi passado, cria também o primeiro step (ainda inativo, user ajusta)
  if (gatewayEvent) {
    const existingSteps = await db
      .select()
      .from(flowSteps)
      .where(eq(flowSteps.gatewayEvent, gatewayEvent));
    const maxOrdem = existingSteps.reduce((m, s) => (s.ordem > m ? s.ordem : m), 0);
    await db.insert(flowSteps).values({
      gatewayEvent,
      ordem: maxOrdem + 1,
      templateKey: key as never,
      delaySeconds: 60 * 60, // default 1h
      ativo: false, // criado desativado pra user revisar
      cancelPrevious: false,
    });
  }

  revalidatePath("/automacoes");
  return { ok: true, key };
}

/**
 * Cria mensagem nova DENTRO de um evento já existente (ou cria o evento implicitamente
 * adicionando a primeira mensagem nele). Cria template + flow_step de uma vez.
 */
export async function createMessageInEventAction(formData: FormData) {
  const gatewayEvent = String(formData.get("gatewayEvent") ?? "").trim();
  const nome = String(formData.get("nome") ?? "").trim();
  const conteudo = String(formData.get("conteudo") ?? "").trim();
  const delayValue = Number(formData.get("delayValue"));
  const delayUnit = String(formData.get("delayUnit") ?? "hours");

  if (!gatewayEvent) throw new Error("Evento obrigatório");
  if (!nome) throw new Error("Nome da mensagem obrigatório");
  if (!conteudo) throw new Error("Conteúdo obrigatório");
  if (conteudo.length > 4000) throw new Error("Conteúdo muito longo");
  if (!Number.isFinite(delayValue) || delayValue < 0) throw new Error("Delay inválido");

  const multipliers: Record<string, number> = {
    seconds: 1,
    minutes: 60,
    hours: 60 * 60,
    days: 60 * 60 * 24,
  };
  const multiplier = multipliers[delayUnit];
  if (!multiplier) throw new Error("Unidade inválida");
  const delaySeconds = Math.floor(delayValue * multiplier);
  if (delaySeconds > 60 * 60 * 24 * 30) throw new Error("Delay máximo: 30 dias");

  // Limite: 5 mensagens por evento
  const existing = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.gatewayEvent, gatewayEvent));
  if (existing.length >= 5) {
    throw new Error("Máximo de 5 mensagens por evento");
  }

  // Gera key do template baseada em nome + evento (pra ficar único)
  const baseKey = nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .substring(0, 30);
  if (!baseKey) throw new Error("Não foi possível gerar key");

  // Garante unicidade — adiciona sufixo se preciso
  let key = `${gatewayEvent}_${baseKey}`;
  let suffix = 1;
  while (
    await db.query.messageTemplates.findFirst({
      where: eq(messageTemplates.key, key as never),
    })
  ) {
    suffix++;
    key = `${gatewayEvent}_${baseKey}_${suffix}`;
    if (suffix > 50) throw new Error("Não foi possível gerar key única");
  }

  await db.insert(messageTemplates).values({
    key: key as never,
    nome,
    descricao: null,
    conteudo,
    conteudoDefault: conteudo,
    placeholdersDisponiveis: [
      "primeiroNome",
      "nome",
      "valor",
      "link_pix",
      "link_checkout",
    ],
  });

  const maxOrdem = existing.reduce((m, s) => (s.ordem > m ? s.ordem : m), 0);
  await db.insert(flowSteps).values({
    gatewayEvent,
    ordem: maxOrdem + 1,
    templateKey: key as never,
    delaySeconds,
    ativo: true,
    cancelPrevious: false,
  });

  revalidatePath("/automacoes");
  return { ok: true, key };
}

/**
 * Apaga uma mensagem (flow_step + template se não está em mais nenhum lugar).
 */
export async function deleteMessageAction(formData: FormData) {
  const stepId = Number(formData.get("stepId"));
  if (!Number.isInteger(stepId) || stepId <= 0) throw new Error("Step ID inválido");

  const step = await db.query.flowSteps.findFirst({
    where: eq(flowSteps.id, stepId),
  });
  if (!step) throw new Error("Mensagem não encontrada");

  await db.delete(flowSteps).where(eq(flowSteps.id, stepId));

  // Se o template não está sendo usado em nenhum outro step E é um template "auto-gerado"
  // (key prefixada com gateway_event), apaga ele também.
  const stillInUse = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.templateKey, step.templateKey));
  const isAutoGenerated = step.templateKey.startsWith(step.gatewayEvent + "_");
  if (stillInUse.length === 0 && isAutoGenerated) {
    await db.delete(messageTemplates).where(eq(messageTemplates.key, step.templateKey));
  }

  revalidatePath("/automacoes");
  return { ok: true };
}

/**
 * Apaga TODAS as mensagens de um evento (efetivamente "apaga o evento" da UI).
 * Templates auto-gerados também são removidos.
 */
export async function deleteEventAction(formData: FormData) {
  const gatewayEvent = String(formData.get("gatewayEvent") ?? "").trim();
  if (!gatewayEvent) throw new Error("Evento obrigatório");

  const steps = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.gatewayEvent, gatewayEvent));

  // Apaga todos os steps
  await db.delete(flowSteps).where(eq(flowSteps.gatewayEvent, gatewayEvent));

  // Apaga templates auto-gerados (prefixados com gatewayEvent_) que não são usados
  // em outros eventos
  for (const s of steps) {
    if (!s.templateKey.startsWith(gatewayEvent + "_")) continue;
    const usedElsewhere = await db
      .select()
      .from(flowSteps)
      .where(eq(flowSteps.templateKey, s.templateKey));
    if (usedElsewhere.length === 0) {
      await db.delete(messageTemplates).where(eq(messageTemplates.key, s.templateKey));
    }
  }

  revalidatePath("/automacoes");
  return { ok: true, removed: steps.length };
}

export async function deleteTemplateAction(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  if (!key) throw new Error("Key obrigatória");

  // Pré-check: não permite apagar se há flow_steps usando
  const inUse = await db
    .select()
    .from(flowSteps)
    .where(eq(flowSteps.templateKey, key as never));
  if (inUse.length > 0) {
    throw new Error(
      `Não dá pra apagar — esse template está em ${inUse.length} passo(s) de fluxo. Remova os passos primeiro.`,
    );
  }

  await db.delete(messageTemplates).where(eq(messageTemplates.key, key as never));

  revalidatePath("/automacoes");
  return { ok: true };
}
