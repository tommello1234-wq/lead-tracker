/**
 * Adaptador Brevex -> formato interno (GatewayEvent).
 *
 * STATUS: STUB. Aguardando exemplo de payload do user pra construir o parser.
 *
 * O webhook handler (server/routes/webhooks.ts) salva qualquer POST do Brevex
 * na tabela `eventos` com source="brevex" e processedOk=false. Isso permite
 * a gente inspecionar o payload e construir o parser depois sem perder dados.
 *
 * Quando tiver um exemplo de payload Brevex, expandir aqui:
 *   - parseBrevexWebhook(): mapear pra EventInput interno
 *   - verifyBrevexSignature(): validar header de segurança
 *
 * Estrutura idêntica ao parseTictoWebhook / parseStripeWebhook pra
 * uniformidade — assim o handler chama sempre `handleGatewayEvent(event)`.
 */
import type { EventInput } from "./flows.js";

type AnyObject = Record<string, unknown>;

/**
 * Por enquanto retorna null pra todos os payloads. O webhook handler
 * vai logar como "unknown" mas SALVAR o payload bruto. Vc dispara um
 * teste no painel da Brevex e a gente inspeciona depois.
 */
export function parseBrevexWebhook(_payload: AnyObject): EventInput | null {
  return null;
}

/**
 * Validação por enquanto desligada (modo dev). Quando souber como Brevex
 * assina (HMAC? token?), implementar comparação timing-safe aqui.
 */
export function verifyBrevexSignature(
  _payload: AnyObject,
  _headers: Headers,
): { valid: boolean; reason?: string } {
  // Permite qualquer request por enquanto — só pra capturar payloads
  // reais e construir o parser depois.
  return { valid: true, reason: "stub-no-validation" };
}
