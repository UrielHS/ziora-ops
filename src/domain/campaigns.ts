import { and, eq, exists, inArray, isNotNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { campaigns, campaignSends, contactConsents, emailTemplates, contacts, contactTags, type CityValue, type ContactSource, type ContactTag } from "@/db/schema";
import { eventContacts, events } from "@/db/shared";
import { sendBatch } from "@/integrations/mail";
import { unsubscribeToken } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";
import { firstName, renderTemplate } from "./template";

/** Destinatarios de una campaña: SOLO contactos con consentimiento de correo vigente. */
export async function resolveRecipients(db: Db, campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new Error("Campaña no encontrada");
  const seg = campaign.segment;

  const conds = [
    isNotNull(contacts.email),
    exists(
      db.select({ one: sql`1` }).from(contactConsents).where(
        and(eq(contactConsents.contactId, contacts.id), eq(contactConsents.channel, "email"), eq(contactConsents.optIn, true)),
      ),
    ),
  ];
  if (seg.tags?.length) {
    conds.push(
      exists(
        db.select({ one: sql`1` }).from(contactTags).where(
          and(eq(contactTags.contactId, contacts.id), inArray(contactTags.tag, seg.tags as ContactTag[])),
        ),
      ),
    );
  }
  if (seg.cities?.length) conds.push(inArray(contacts.city, seg.cities as CityValue[]));
  if (seg.sources?.length) conds.push(inArray(contacts.source, seg.sources as ContactSource[]));
  if (seg.contactIds?.length) conds.push(inArray(contacts.id, seg.contactIds));
  if (seg.eventId) {
    conds.push(
      exists(
        db.select({ one: sql`1` }).from(eventContacts).where(
          // Asistentes del evento en Event Ops que ya se importaron a Ziora Ops.
          and(eq(eventContacts.contactId, contacts.eventOpsContactId), eq(eventContacts.eventId, seg.eventId)),
        ),
      ),
    );
  }

  return db
    .select({ id: contacts.id, name: contacts.name, email: contacts.email, city: contacts.city })
    .from(contacts)
    .where(and(...conds));
}

/**
 * Envía una campaña. Es idempotente: campaign_sends tiene único (campaña, email),
 * así que reintentar no duplica correos a quien ya se le envió.
 */
export async function sendCampaign(db: Db, campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId)).limit(1);
  if (!campaign) throw new Error("Campaña no encontrada");
  if (campaign.status === "sent") return { sent: 0, skipped: 0 };
  const [template] = await db.select().from(emailTemplates).where(eq(emailTemplates.id, campaign.templateId)).limit(1);
  if (!template) throw new Error("Plantilla no encontrada");

  let event: { name: string; date: string | null; registrationUrl: string | null } | undefined;
  if (campaign.eventId) {
    [event] = await db
      .select({ name: events.name, date: events.date, registrationUrl: events.registrationUrl })
      .from(events)
      .where(eq(events.id, campaign.eventId))
      .limit(1);
  }

  await db.update(campaigns).set({ status: "sending" }).where(eq(campaigns.id, campaignId));

  const appUrl = requireEnv("APP_URL");
  const unsubSecret = requireEnv("UNSUBSCRIBE_SECRET");
  const from = campaign.fromEmail ?? requireEnv("MAIL_FROM");
  const recipients = await resolveRecipients(db, campaignId);

  let sent = 0;
  let skipped = 0;
  for (let i = 0; i < recipients.length; i += 100) {
    const chunk = recipients.slice(i, i + 100);
    // Reserva la fila antes de enviar; si ya existía, ese contacto se salta.
    const reserved = await db
      .insert(campaignSends)
      .values(chunk.map((r) => ({ campaignId, contactId: r.id, email: r.email!, status: "queued" as const })))
      .onConflictDoNothing()
      .returning({ id: campaignSends.id, email: campaignSends.email, contactId: campaignSends.contactId });
    skipped += chunk.length - reserved.length;
    if (reserved.length === 0) continue;

    const byEmail = new Map(chunk.map((r) => [r.email!, r]));
    const emails = reserved.map((s) => {
      const r = byEmail.get(s.email)!;
      const unsubscribeUrl = `${appUrl}/api/unsubscribe?t=${encodeURIComponent(unsubscribeToken(unsubSecret, r.id))}`;
      const vars = {
        nombre: firstName(r.name),
        nombre_completo: r.name,
        email: r.email,
        ciudad: r.city,
        evento: event?.name,
        evento_fecha: event?.date,
        evento_registro: event?.registrationUrl,
        baja: unsubscribeUrl,
      };
      return {
        to: s.email,
        subject: renderTemplate(campaign.subject ?? template.subject, vars),
        html: renderTemplate(template.html, vars),
        unsubscribeUrl,
        tags: [{ name: "campaign", value: campaignId }],
      };
    });

    try {
      const ids = await sendBatch(from, emails);
      await Promise.all(
        reserved.map((s, idx) =>
          db.update(campaignSends).set({ status: "sent", providerMessageId: ids[idx] }).where(eq(campaignSends.id, s.id)),
        ),
      );
      sent += reserved.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db
        .update(campaignSends)
        .set({ status: "failed", error: msg })
        .where(inArray(campaignSends.id, reserved.map((s) => s.id)));
      await db.update(campaigns).set({ status: "failed" }).where(eq(campaigns.id, campaignId));
      throw err;
    }
  }

  await db.update(campaigns).set({ status: "sent", sentAt: new Date() }).where(eq(campaigns.id, campaignId));
  return { sent, skipped };
}
