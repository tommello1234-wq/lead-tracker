import { db } from "../db/client";
import { sql } from "drizzle-orm";

async function main() {
  const r = await db.execute(sql`
    select event_type, received_at, payload
    from eventos
    where source = 'stripe' and event_type = 'signature_invalid'
    order by received_at desc
    limit 5
  `);
  const rows = r as unknown as Array<{
    event_type: string;
    received_at: Date;
    payload: { rawBody?: string; reason?: string };
  }>;
  for (const row of rows) {
    console.log("---");
    console.log("Received at:", row.received_at);
    console.log("Reason:", row.payload?.reason);
    if (row.payload?.rawBody) {
      try {
        const body = JSON.parse(row.payload.rawBody);
        console.log("Stripe event type real:", body.type);
        console.log("Stripe livemode:", body.livemode);
        console.log("Stripe id:", body.id);
      } catch {
        console.log("Raw (200 chars):", row.payload.rawBody.substring(0, 200));
      }
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
