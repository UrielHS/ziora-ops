import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { db } from "@/db";
import { campaignSends } from "@/db/schema";
import { emailBounced, optOutByEmail } from "@/domain/contacts";
import { requireEnv } from "@/lib/env";

// Resend → Webhooks → endpoint <APP_URL>/api/webhooks/resend, eventos email.*
const STATUS: Record<string, "delivered" | "opened" | "clicked" | "bounced" | "complained"> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

export async function POST(req: Request) {
  const raw = await req.text();
  let evt: { type: string; data: { email_id: string; to?: string[] } };
  try {
    evt = new Webhook(requireEnv("RESEND_WEBHOOK_SECRET")).verify(raw, {
      "svix-id": req.headers.get("svix-id") ?? "",
      "svix-timestamp": req.headers.get("svix-timestamp") ?? "",
      "svix-signature": req.headers.get("svix-signature") ?? "",
    }) as typeof evt;
  } catch {
    return NextResponse.json({ error: "firma inválida" }, { status: 401 });
  }

  const status = STATUS[evt.type];
  if (status) {
    await db.update(campaignSends).set({ status }).where(eq(campaignSends.providerMessageId, evt.data.email_id));
  }
  // Queja de spam: baja (el lead en trabajo pasa a perdido). Rebote duro: solo se quita el permiso de correo; el lead sigue.
  if (status === "complained" && evt.data.to?.[0]) await optOutByEmail(db, evt.data.to[0]);
  if (status === "bounced" && evt.data.to?.[0]) await emailBounced(db, evt.data.to[0]);
  return NextResponse.json({ ok: true });
}
