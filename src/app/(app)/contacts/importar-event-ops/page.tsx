import Link from "next/link";
import { and, asc, desc, eq, exists, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { importEventOpsContacts } from "@/actions/contacts";
import { SelectAll } from "@/components/select-all";
import { Badge, btn, Card, Empty, Field, inputCls, PageHeader, Select } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ui/form";
import { db } from "@/db";
import { contacts } from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { eoContacts, eoContactTags, eoContactTagEnum, eventContacts, events, organizations } from "@/db/shared";
import { CITY, CONTACT_TAG } from "@/lib/labels";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";
const LIMIT = 200;
type SP = { q?: string; tag?: string; evento?: string; ver?: string };

/**
 * Contactos de Event Ops para copiar a Ziora Ops. Solo lectura sobre Event Ops: aquí no se edita nada de allá.
 * La copia es independiente; el enlace event_ops_contact_id evita importar dos veces a la misma persona.
 */
// Las dos tablas se llaman "contacts" (ops y public): con alias para poder cruzarlas en una consulta.
const mine = alias(contacts, "zc");

export default async function ImportEventOpsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("contacts.import");
  const sp = await searchParams;
  const where: SQL[] = [eq(eoContacts.type, "person")];
  if (sp.q) where.push(or(ilike(eoContacts.name, `%${sp.q}%`), ilike(eoContacts.email, `%${sp.q}%`), ilike(organizations.name, `%${sp.q}%`))!);
  if (sp.tag) {
    where.push(exists(db.select({ x: sql`1` }).from(eoContactTags)
      .where(and(eq(eoContactTags.contactId, eoContacts.id), eq(eoContactTags.tag, sp.tag as (typeof eoContactTagEnum.enumValues)[number])))));
  }
  if (sp.evento) {
    where.push(exists(db.select({ x: sql`1` }).from(eventContacts)
      .where(and(eq(eventContacts.contactId, eoContacts.id), eq(eventContacts.eventId, sp.evento)))));
  }
  if (sp.ver !== "todos") where.push(isNull(mine.id)); // por defecto, solo los que faltan por importar

  const [rows, eventList, tagRows] = await Promise.all([
    db.select({ c: eoContacts, org: organizations.name, importedId: mine.id })
      .from(eoContacts)
      .leftJoin(organizations, eq(organizations.id, eoContacts.organizationId))
      .leftJoin(mine, eq(mine.eventOpsContactId, eoContacts.id))
      .where(and(...where))
      .orderBy(desc(eoContacts.updatedAt))
      .limit(LIMIT),
    db.select({ id: events.id, name: events.name, date: events.date }).from(events).orderBy(desc(events.date)).limit(40),
    db.select().from(eoContactTags),
  ]);
  const tagsOf = (id: string) => tagRows.filter((t) => t.contactId === id).map((t) => t.tag);
  const usedTags = [...new Set(tagRows.map((t) => t.tag))].sort();
  const [{ pending }] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(eoContacts)
    .leftJoin(mine, eq(mine.eventOpsContactId, eoContacts.id))
    .where(and(eq(eoContacts.type, "person"), isNotNull(eoContacts.email), isNull(mine.id)));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Ventas · Contactos"
        title="Importar de Event Ops"
        subtitle="Elige a quién traer a Ziora Ops. Se copia una vez: lo que edites después no cambia Event Ops. Si el correo ya existe aquí, solo se completan los datos que falten."
        actions={<Link href="/contacts" className={btn("secondary")}>Volver a Contactos</Link>}
      />

      <Card className="p-5">
        <form className="grid gap-3 md:grid-cols-[2fr_1fr_1.4fr_1fr_auto] md:items-end">
          <Field label="Buscar"><input name="q" defaultValue={sp.q} placeholder="Nombre, correo u organización" className={inputCls} /></Field>
          <Field label="Etiqueta"><Select name="tag" defaultValue={sp.tag} placeholder="Todas" options={usedTags.map((t) => [t, CONTACT_TAG[t] ?? t])} /></Field>
          <Field label="Evento"><Select name="evento" defaultValue={sp.evento} placeholder="Todos" options={eventList.map((e) => [e.id, `${e.name}${e.date ? ` · ${e.date}` : ""}`])} /></Field>
          <Field label="Mostrar"><Select name="ver" defaultValue={sp.ver ?? "pendientes"} options={[["pendientes", "Por importar"], ["todos", "Todos"]]} /></Field>
          <button className={btn("secondary")}>Filtrar</button>
        </form>
        <p className="mt-3 text-xs text-muted">{pending} contactos de Event Ops con correo todavía no están en Ziora Ops.</p>
      </Card>

      {rows.length === 0 ? (
        <Empty title="No hay contactos con esos filtros" text="Prueba con otra búsqueda o elige Mostrar: Todos." />
      ) : (
        <Card className="p-0">
          <ActionForm action={importEventOpsContacts} className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
              <SelectAll name="ids[]" />
              <div className="flex items-center gap-3">
                <span className="text-xs text-muted">{rows.length === LIMIT ? `Se muestran los primeros ${LIMIT}; usa los filtros para acotar.` : `${rows.length} contactos`}</span>
                <Submit>Importar seleccionados</Submit>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="label text-left">
                    <th className="w-10 px-5 py-2" />
                    <th className="px-2 py-2">Nombre</th>
                    <th className="px-2 py-2">Correo</th>
                    <th className="px-2 py-2">Organización</th>
                    <th className="px-2 py-2">Ciudad</th>
                    <th className="px-2 py-2">Etiquetas</th>
                    <th className="px-2 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ c, org, importedId }) => {
                    const noEmail = !c.email;
                    return (
                      <tr key={c.id} className="border-t border-[#EFEDE6]">
                        <td className="px-5 py-2.5">
                          <input type="checkbox" name="ids[]" value={c.id} disabled={noEmail || !!importedId} className="h-4 w-4 accent-emerald" aria-label={`Importar ${c.name}`} />
                        </td>
                        <td className="px-2 py-2.5 font-semibold">{c.name}</td>
                        <td className="px-2 py-2.5 text-muted">{c.email ?? <span className="text-faint">Sin correo</span>}</td>
                        <td className="px-2 py-2.5 text-muted">{org ?? "—"}</td>
                        <td className="px-2 py-2.5 text-muted">{c.city ? CITY[c.city] ?? c.city : "—"}</td>
                        <td className="px-2 py-2.5">
                          <div className="flex flex-wrap gap-1">{tagsOf(c.id).map((t) => <Badge key={t} tone="gray">{CONTACT_TAG[t] ?? t}</Badge>)}</div>
                        </td>
                        <td className="px-2 py-2.5 text-right">
                          {importedId ? <Badge tone="green">Ya importado</Badge> : noEmail ? <Badge tone="gray">Sin correo</Badge> : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
