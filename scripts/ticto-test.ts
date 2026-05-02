/**
 * Smoke test da Ticto API.
 * Roda: node --env-file=.env.local --import tsx scripts/ticto-test.ts
 */
import {
  getOrdersSummary,
  getOrdersHistory,
  getSubscriptionsSummary,
  getSubscriptionsHistory,
} from "../server/lib/ticto-api";

async function main() {
  console.log("=== Ticto API smoke test ===\n");

  console.log("1. Orders summary:");
  try {
    const ordSummary = await getOrdersSummary();
    console.log(JSON.stringify(ordSummary, null, 2).substring(0, 1500));
  } catch (e) {
    console.error("ERROR:", e instanceof Error ? e.message : e);
  }

  console.log("\n2. Subscriptions summary:");
  try {
    const subSummary = await getSubscriptionsSummary();
    console.log(JSON.stringify(subSummary, null, 2).substring(0, 1500));
  } catch (e) {
    console.error("ERROR:", e instanceof Error ? e.message : e);
  }

  console.log("\n3. Orders history page 1:");
  try {
    const ordHistory = await getOrdersHistory(1);
    console.log(JSON.stringify(ordHistory, null, 2).substring(0, 4000));
  } catch (e) {
    console.error("ERROR:", e instanceof Error ? e.message : e);
  }

  console.log("\n4. Subscriptions history page 1:");
  try {
    const subHistory = await getSubscriptionsHistory(1);
    console.log(JSON.stringify(subHistory, null, 2).substring(0, 4000));
  } catch (e) {
    console.error("ERROR:", e instanceof Error ? e.message : e);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
