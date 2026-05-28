/**
 * Handler de mensagens RECEBIDAS via Evolution webhook.
 *
 * Quando o cliente responde no WhatsApp:
 *   1. Marca lead.respondeuEm (se ainda null)
 *   2. Cancela mensagens pendentes do lead (status pending → skipped)
 *      pra que mensagens automatizadas em sequência (ex: 2º follow-up de
 *      carrinho_abandonado) não sejam enviadas se o cliente já respondeu
 *   3. Salva audit em `eventos`
 *
 * O Evolution dispara o webhook pra TODAS as mensagens (inclusive as
 * que NÓS enviamos). Filtramos por `fromMe=false`.
 */
import { db } from "../../db/client.js";
import { leads, mensagensAgendadas, eventos } from "../../db/schema.js";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { normalizePhone, phoneVariants } from "./evolution.js";

type EvolutionPayload = {
  event?: string;
  instance?: string;
  data?: {
    key?: {
      remoteJid?: string;
      fromMe?: boolean;
      id?: string;
    };
    message?: Record<string, unknown>;
    messageType?: string;
    messageTimestamp?: number;
    pushName?: string;
  };
};

function extractPhone(remoteJid: string | undefined): string | null {
  if (!remoteJid) return null;
  // remoteJid: "5543991932403@s.whatsapp.net" | "groupId@g.us"
  if (remoteJid.endsWith("@g.us")) return null; // grupo, ignora
  const num = remoteJid.split("@")[0];
  if (!num) return null;
  return normalizePhone(num);
}

function extractText(message: Record<string, unknown> | undefined): string {
  if (!message) return "";
  // Evolution pode mandar texto em vários formatos:
  // - conversation (texto puro)
  // - extendedTextMessage.text (texto com features extras)
  // - imageMessage.caption / videoMessage.caption (mídia com legenda)
  // - audioMessage / stickerMessage (sem texto, retorna vazio)
  if (typeof message.conversation === "string") return message.conversation;
  const ext = message.extendedTextMessage as { text?: string } | undefined;
  if (ext?.text) return ext.text;
  const img = message.imageMessage as { caption?: string } | undefined;
  if (img?.caption) return img.caption;
  const vid = message.videoMessage as { caption?: string } | undefined;
  if (vid?.caption) return vid.caption;
  // Áudio/figurinha/etc — retorna vazio mas a presença da mensagem ainda
  // conta como "respondeu"
  return "";
}

export type IncomingResult = {
  ok: boolean;
  ignored?: boolean;
  reason?: string;
  leadId?: number;
  cancelled?: number;
};

export async function handleEvolutionIncoming(
  payload: EvolutionPayload,
): Promise<IncomingResult> {
  // Só processa MESSAGES_UPSERT (mensagem nova).
  const event = payload.event ?? "";
  if (!/messages[._-]upsert/i.test(event)) {
    return { ok: true, ignored: true, reason: `Evento '${event}' não tratado` };
  }

  const data = payload.data;
  if (!data?.key) {
    return { ok: true, ignored: true, reason: "payload sem data.key" };
  }

  // Mensagem que NÓS enviamos — ignora (não é resposta do cliente)
  if (data.key.fromMe === true) {
    return { ok: true, ignored: true, reason: "fromMe=true (nossa mensagem)" };
  }

  const phone = extractPhone(data.key.remoteJid);
  if (!phone) {
    return { ok: true, ignored: true, reason: "sem telefone (grupo ou inválido)" };
  }

  // Acha lead pelo telefone — testa variantes com/sem 9º dígito (BR),
  // porque o WhatsApp manda o JID sem o 9 mas salvamos o contato com ele.
  const lead = await db.query.leads.findFirst({
    where: inArray(leads.contato, phoneVariants(phone)),
  });

  if (!lead) {
    // Mensagem de número que não tem lead — registra audit mas não cancela nada
    await db.insert(eventos).values({
      source: "evolution",
      eventType: "cliente_respondeu_sem_lead",
      payload: payload as object,
      processedOk: true,
      erro: `Telefone ${phone} sem lead correspondente`,
    });
    return { ok: true, ignored: true, reason: `lead não encontrado pra ${phone}` };
  }

  const now = new Date();
  const text = extractText(data.message);

  // Marca respondeuEm se ainda null (preserva 1ª resposta)
  await db
    .update(leads)
    .set({ respondeuEm: now, atualizadoEm: now })
    .where(and(eq(leads.id, lead.id), isNull(leads.respondeuEm)));

  // Cancela mensagens pendentes — todas, sem distinção de template.
  // Justificativa: se cliente respondeu, qualquer mensagem automática
  // pendente seria fora de contexto.
  const cancelResult = await db
    .update(mensagensAgendadas)
    .set({ status: "skipped", erro: "Cliente respondeu antes do envio" })
    .where(
      and(
        eq(mensagensAgendadas.leadId, lead.id),
        eq(mensagensAgendadas.status, "pending"),
      ),
    );
  const cancelled = (cancelResult as unknown as { rowCount?: number }).rowCount ?? 0;

  // Audit log — salva texto e quantidade cancelada
  await db.insert(eventos).values({
    leadId: lead.id,
    produtoId: lead.produtoId,
    source: "evolution",
    eventType: "cliente_respondeu",
    payload: {
      ...payload,
      _summary: {
        text: text.slice(0, 500),
        cancelledMessages: cancelled,
      },
    } as object,
    processedOk: true,
  });

  return { ok: true, leadId: lead.id, cancelled };
}
