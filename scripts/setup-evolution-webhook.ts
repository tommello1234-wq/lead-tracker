/**
 * Configura o webhook do Evolution pra apontar pro Lead Tracker.
 *
 * Pré-requisito: rodar `vercel env pull .env.local` antes pra baixar
 * EVOLUTION_API_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE_NAME e
 * (opcional) EVOLUTION_WEBHOOK_SECRET da Vercel.
 *
 * Uso: node --env-file=.env.local --import tsx scripts/setup-evolution-webhook.ts
 */
const TARGET_WEBHOOK_URL =
  process.env.LEAD_TRACKER_URL ?? "https://lead-tracker-three-xi.vercel.app";

async function main() {
  const evoUrl = process.env.EVOLUTION_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE_NAME;
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;

  if (!evoUrl || !apiKey || !instance) {
    console.error("❌ Creds Evolution faltando no .env.local.");
    console.error(`   EVOLUTION_API_URL=${evoUrl ? "✓" : "✗ vazio"}`);
    console.error(`   EVOLUTION_API_KEY=${apiKey ? "✓" : "✗ vazio"}`);
    console.error(`   EVOLUTION_INSTANCE_NAME=${instance ? "✓" : "✗ vazio"}`);
    console.error(`\n   Rode antes: vercel env pull .env.local`);
    process.exit(1);
  }

  const webhookUrl = `${TARGET_WEBHOOK_URL}/api/webhooks/evolution`;
  console.log(`Configurando webhook do Evolution:`);
  console.log(`  Instance: ${instance}`);
  console.log(`  Target:   ${webhookUrl}`);
  console.log(`  Secret:   ${secret ? "✓ configurado" : "✗ sem auth (modo dev)"}\n`);

  const body: Record<string, unknown> = {
    webhook: {
      enabled: true,
      url: webhookUrl,
      webhook_by_events: false,
      webhook_base64: false,
      events: ["MESSAGES_UPSERT"],
    },
  };

  // Evolution v2.x — usa formato {webhook: {...}} no body
  const res = await fetch(`${evoUrl}/webhook/set/${instance}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep text */
  }

  if (!res.ok) {
    console.error(`❌ Falhou: ${res.status}`);
    console.error(parsed);
    process.exit(1);
  }

  console.log("✅ Webhook configurado!");
  console.log(JSON.stringify(parsed, null, 2));

  // Verifica
  const check = await fetch(`${evoUrl}/webhook/find/${instance}`, {
    headers: { apikey: apiKey },
  });
  if (check.ok) {
    const cfg = await check.json();
    console.log("\n=== Config atual ===");
    console.log(JSON.stringify(cfg, null, 2));
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
