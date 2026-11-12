"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import type { Actor } from "@/domain/leads";
import { recordDm } from "@/domain/social-dm";
import { addContactChannel, setSocialLeadType } from "@/domain/social-leads";
import { formAction, type ActionState } from "@/lib/action";
import { requirePermission } from "@/lib/session";

const id = z.uuid();

async function actor(): Promise<Actor> {
  const { user } = await requirePermission("leads.manage");
  return { userId: user.id, label: user.name };
}

function refresh(leadId: string) {
  revalidatePath("/leads", "layout");
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${leadId}`);
}

/** «Le escribí»: registra el DM que tocaba. Un doble clic no lo cuenta dos veces. */
const _recordDm = formAction(z.object({ id }), async (d) => {
  const r = await recordDm(db, d.id, await actor());
  refresh(d.id);
  if (r.recorded) return `DM ${r.step} registrado`;
  return r.step ? `El DM ${r.step} ya estaba registrado` : "Ya se mandaron los 3 mensajes";
});

/** Agrega correo y/o teléfono a un lead que solo tenía su @. */
const _addContactChannel = formAction(
  z.object({ id, email: z.email("correo válido").max(200).optional(), phone: z.string().trim().max(40).optional() }),
  async (d) => {
    if (!d.email && !d.phone) throw new Error("Escribe un correo o un teléfono");
    const r = await addContactChannel(db, d.id, { email: d.email, phone: d.phone }, await actor());
    if (!r.ok) throw new Error("Ese correo o teléfono ya es de otro contacto.");
    refresh(d.id);
    if (r.added) return r.unreadablePhone ? "Correo agregado; no se pudo leer el teléfono" : "Dato agregado";
    if (r.unreadablePhone) throw new Error("No se pudo leer el teléfono");
    return "Ya lo tenía";
  },
);

const _setSocialLeadType = formAction(z.object({ id, type: z.enum(["psicologo", "influencer"]) }), async (d) => {
  await setSocialLeadType(db, d.id, d.type, await actor());
  refresh(d.id);
  return "Tipo actualizado";
});

export async function recordDmAction(prev: ActionState, fd: FormData) { return _recordDm(prev, fd); }
export async function addContactChannelAction(prev: ActionState, fd: FormData) { return _addContactChannel(prev, fd); }
export async function setSocialLeadTypeAction(prev: ActionState, fd: FormData) { return _setSocialLeadType(prev, fd); }
