"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  accountContacts, accounts, bugs, campaigns, contacts, contentPieces, contentSuggestions, contracts, deals, demoRequests,
  emailTemplates, epics, followups, socialAccounts, sprints, tasks, tickets,
} from "@/db/schema";
import { formAction, type ActionState } from "@/lib/action";
import { can, type Permission } from "@/lib/permissions";
import { requireAccess } from "@/lib/session";

/**
 * Borrado de cualquier registro editable de Ziora Ops. Cada tipo dice quién puede borrarlo.
 * Lo que dependa del registro se resuelve por las llaves foráneas (ver el aviso de cada botón Eliminar).
 * No se borran datos que vienen de fuera (usuarios de la app, PRs, métricas) ni campañas ya enviadas.
 */
const KINDS = {
  piece: { table: contentPieces, perms: ["content.manage"], label: "La pieza" },
  suggestion: { table: contentSuggestions, perms: ["suggestions.decide", "content.manage"], label: "La sugerencia" },
  template: { table: emailTemplates, perms: ["content.manage"], label: "La plantilla" },
  social_account: { table: socialAccounts, perms: ["content.manage", "analytics.view"], label: "La cuenta de red social" },
  contact: { table: contacts, perms: ["sales.manage", "content.manage", "team.manage"], label: "El contacto" },
  demo: { table: demoRequests, perms: ["sales.manage"], label: "La demo" },
  account: { table: accounts, perms: ["sales.manage"], label: "La cuenta" },
  deal: { table: deals, perms: ["sales.manage"], label: "La oportunidad" },
  contract: { table: contracts, perms: ["sales.manage"], label: "El contrato" },
  followup: { table: followups, perms: ["followups.manage"], label: "El seguimiento" },
  ticket: { table: tickets, perms: ["tickets.triage"], label: "El ticket" },
  bug: { table: bugs, perms: ["tickets.triage"], label: "El bug" },
  task: { table: tasks, perms: [], label: "La tarea" }, // cualquier persona del equipo, como crearla
  epic: { table: epics, perms: ["team.manage"], label: "La épica" },
  sprint: { table: sprints, perms: ["team.manage"], label: "El sprint" },
} as const satisfies Record<string, { perms: readonly Permission[]; label: string; table: { id: unknown } }>;

export type DeleteKind = keyof typeof KINDS | "account_contact";

async function guard(kind: DeleteKind, id: string) {
  if (kind === "template") {
    const [used] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.templateId, id)).limit(1);
    if (used) throw new Error("Esta plantilla ya se usó en una campaña: no se puede borrar (las campañas guardan qué se envió).");
  }
}

const _deleteRecord = formAction(
  z.object({ kind: z.enum([...Object.keys(KINDS), "account_contact"] as unknown as [DeleteKind, ...DeleteKind[]]), id: z.string().min(1).max(200) }),
  async ({ kind, id }) => {
    const access = await requireAccess();
    if (kind === "account_contact") {
      // id = "<cuenta>:<contacto>": quita a la persona de la cuenta, el contacto sigue en Contactos.
      if (!can(access, "sales.manage")) throw new Error("No tienes permiso para esto.");
      const [accountId, contactId] = id.split(":").map((x) => z.uuid().parse(x));
      await db.delete(accountContacts).where(and(eq(accountContacts.accountId, accountId), eq(accountContacts.contactId, contactId)));
      revalidatePath("/", "layout");
      return "Persona quitada de la cuenta.";
    }
    const k = KINDS[kind];
    if (k.perms.length && !k.perms.some((p) => can(access, p))) throw new Error("No tienes permiso para borrar esto.");
    const uuid = z.uuid().parse(id);
    await guard(kind, uuid);
    const table = k.table as typeof tasks; // todas tienen columna id uuid
    const gone = await db.delete(table).where(eq(table.id, uuid)).returning({ id: table.id });
    if (!gone.length) throw new Error(`${k.label} ya no existe.`);
    revalidatePath("/", "layout");
    return `${k.label} se eliminó.`;
  },
);

// Next exige que cada export de un archivo "use server" sea una función async declarada.
export async function deleteRecord(prev: ActionState, fd: FormData) {
  return _deleteRecord(prev, fd);
}
