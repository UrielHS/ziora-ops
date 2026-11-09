"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { stopActiveEnrollments, type Actor } from "@/domain/leads";
import { enroll, enrollMessage } from "@/domain/sequences";
import { formAction, type ActionState } from "@/lib/action";
import { requirePermission } from "@/lib/session";

const id = z.uuid();
// Sin casillas marcadas el formulario no manda ids[]: se normaliza a [] para que el mensaje sea el nuestro y no el de zod.
const ids = z.preprocess((v) => v ?? [], z.array(z.uuid()).min(1, "elige al menos un lead"));

async function actor(): Promise<Actor> {
  const { user } = await requirePermission("leads.manage");
  return { userId: user.id, label: user.name };
}

function refresh(leadId?: string) {
  revalidatePath("/leads", "layout");
  revalidatePath("/contacts");
  if (leadId) revalidatePath(`/contacts/${leadId}`);
}

/** Enrolar desde la ficha (un id) o desde el kanban (varios). Solo nuevo/contactado; no duplica. */
const _enroll = formAction(z.object({ ids, sequenceId: id }), async (d) => {
  const r = await enroll(db, d.ids, d.sequenceId, await actor());
  refresh(d.ids.length === 1 ? d.ids[0] : undefined);
  return enrollMessage(r);
});

const _stop = formAction(z.object({ id }), async (d) => {
  await stopActiveEnrollments(db, d.id, "manual");
  refresh(d.id);
  return "Secuencia detenida";
});

export async function enrollAction(prev: ActionState, fd: FormData) { return _enroll(prev, fd); }
export async function stopEnrollmentAction(prev: ActionState, fd: FormData) { return _stop(prev, fd); }
