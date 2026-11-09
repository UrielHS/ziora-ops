"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { campaigns, emailTemplates, cityEnum, contactSourceEnum, contactTagEnum } from "@/db/schema";
import { sendCampaign } from "@/domain/campaigns";
import { formAction, type ActionState } from "@/lib/action";
import { requirePermission } from "@/lib/session";

const _createCampaign = formAction(
  z.object({
    name: z.string().trim().min(3).max(120),
    templateId: z.uuid("elige una plantilla"),
    subject: z.string().max(200).optional(),
    tags: z.array(z.enum(contactTagEnum.enumValues)).default([]),
    cities: z.array(z.enum(cityEnum.enumValues)).default([]),
    sources: z.array(z.enum(contactSourceEnum.enumValues)).default([]),
    eventId: z.uuid().optional(),
    scheduledAt: z.string().optional(),
  }),
  async (d) => {
    const { user } = await requirePermission("content.manage");
    const [c] = await db.insert(campaigns).values({
      name: d.name, templateId: d.templateId, subject: d.subject ?? null, eventId: d.eventId ?? null, createdBy: user.id,
      segment: { tags: d.tags, cities: d.cities, sources: d.sources, ...(d.eventId ? { eventId: d.eventId } : {}) },
      status: d.scheduledAt ? "scheduled" : "draft",
      scheduledAt: d.scheduledAt ? new Date(`${d.scheduledAt}:00-06:00`) : null,
    }).returning({ id: campaigns.id });
    revalidatePath("/campaigns");
    redirect(`/campaigns/${c.id}`);
  },
);

export async function sendCampaignNow(_prev: ActionState, fd: FormData): Promise<ActionState> {
  await requirePermission("campaigns.send");
  const id = z.uuid().parse(fd.get("id"));
  if (!process.env.RESEND_API_KEY) {
    return { error: "Falta RESEND_API_KEY. Configura Resend (Ajustes → Integraciones) para enviar." };
  }
  try {
    const r = await sendCampaign(db, id);
    revalidatePath(`/campaigns/${id}`);
    return { ok: true, message: `Enviados: ${r.sent}. Ya enviados antes: ${r.skipped}.` };
  } catch (e) {
    revalidatePath(`/campaigns/${id}`);
    return { error: e instanceof Error ? e.message : "No se pudo enviar" };
  }
}

export async function deleteDraftCampaign(fd: FormData) {
  await requirePermission("content.manage");
  await db.delete(campaigns).where(and(eq(campaigns.id, z.uuid().parse(fd.get("id"))), eq(campaigns.status, "draft")));
  revalidatePath("/campaigns");
  redirect("/campaigns");
}

const _saveTemplate = formAction(
  z.object({
    id: z.uuid().optional(),
    name: z.string().trim().min(2).max(120),
    subject: z.string().trim().min(2).max(200),
    previewText: z.string().max(200).optional(),
    html: z.string().min(20, "la plantilla está vacía").max(200_000),
  }),
  async ({ id, ...d }) => {
    const { user } = await requirePermission("content.manage");
    if (!d.html.includes("{{{baja}}}")) throw new Error("La plantilla debe incluir el enlace de baja {{{baja}}} (LFPDPPP).");
    if (id) {
      await db.update(emailTemplates).set(d).where(eq(emailTemplates.id, id));
      revalidatePath(`/templates/${id}`);
      revalidatePath("/templates");
      return "Plantilla guardada";
    }
    const [t] = await db.insert(emailTemplates).values({ ...d, createdBy: user.id }).returning({ id: emailTemplates.id });
    revalidatePath("/templates");
    redirect(`/templates/${t.id}`);
  },
);

// Next exige que cada export de un archivo "use server" sea una función async declarada.
export async function createCampaign(prev: ActionState, fd: FormData) {
  return _createCampaign(prev, fd);
}
export async function saveTemplate(prev: ActionState, fd: FormData) {
  return _saveTemplate(prev, fd);
}
