import Link from "next/link";
import { and, count, desc, eq, exists, ilike, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { Link2, Mail, MailX, Phone } from "lucide-react";
import { createContact, importLeadsCsv, setConsent, updateContact } from "@/actions/contacts";
import { Avatar, Badge, btn, Card, cn, Field, inputCls, PageHeader, Select } from "@/components/ui";
import { ActionForm, Modal, Submit } from "@/components/ui/form";
import { db } from "@/db";
import { listUsers, userOptions } from "@/db/queries";
import { contactConsents, demoRequests, cityEnum, contacts, contactSourceEnum, contactTagEnum, contactTags, sequences } from "@/db/schema";
import { fmtDate } from "@/lib/format";
import { CITY, CONTACT_SOURCE, CONTACT_TAG } from "@/lib/labels";
import { DeleteButton } from "@/components/ui/delete-button";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";
const PAGE = 40;
type SP = { q?: string; tag?: string; city?: string; source?: string; consent?: string; page?: string; nuevo?: string };

const ZIORA_TAGS = ["psychologist", "lead", "clinic", "ziora_user"] as const;

function TagPicker({ selected = [] }: { selected?: string[] }) {
  const order = [...ZIORA_TAGS, ...contactTagEnum.enumValues.filter((t) => !(ZIORA_TAGS as readonly string[]).includes(t))];
  return (
    <div className="flex flex-wrap gap-1.5">
      {order.map((t) => (
        <label key={t} className="cursor-pointer">
          <input type="checkbox" name="tags[]" value={t} defaultChecked={selected.includes(t)} className="peer sr-only" />
          <span className="pill border border-line bg-white text-muted peer-checked:border-emerald/40 peer-checked:bg-mint peer-checked:text-emerald">{CONTACT_TAG[t] ?? t}</span>
        </label>
      ))}
    </div>
  );
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("leads.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1));
  const where: SQL[] = [];
  if (sp.q) where.push(or(ilike(contacts.name, `%${sp.q}%`), ilike(contacts.email, `%${sp.q}%`))!);
  if (sp.city) where.push(eq(contacts.city, sp.city as (typeof cityEnum.enumValues)[number]));
  if (sp.source) where.push(eq(contacts.source, sp.source as (typeof contactSourceEnum.enumValues)[number]));
  if (sp.tag) where.push(exists(db.select({ x: sql`1` }).from(contactTags).where(and(eq(contactTags.contactId, contacts.id), eq(contactTags.tag, sp.tag as (typeof contactTagEnum.enumValues)[number])))));
  if (sp.consent === "yes") where.push(eq(contactConsents.optIn, true));
  if (sp.consent === "no") where.push(or(isNull(contactConsents.optIn), eq(contactConsents.optIn, false))!);

  const base = db
    .select({ c: contacts, optIn: contactConsents.optIn, optedOutAt: contactConsents.optedOutAt, evidence: contactConsents.evidence })
    .from(contacts)
    .leftJoin(contactConsents, and(eq(contactConsents.contactId, contacts.id), eq(contactConsents.channel, "email")))
    .where(and(...where));
  const users = await listUsers();
  const activeSequences = await db.select({ id: sequences.id, name: sequences.name }).from(sequences).where(eq(sequences.active, true)).orderBy(sequences.name);
  const [rows, [{ total }], [stats]] = await Promise.all([
    base.orderBy(desc(contacts.updatedAt)).limit(PAGE).offset((page - 1) * PAGE),
    db.select({ total: count() }).from(contacts).leftJoin(contactConsents, and(eq(contactConsents.contactId, contacts.id), eq(contactConsents.channel, "email"))).where(and(...where)),
    db.select({
      all: sql<number>`count(*)::int`,
      psych: sql<number>`count(*) filter (where exists (select 1 from ops.contact_tags t where t.contact_id = ${contacts.id} and t.tag = 'psychologist'))::int`,
      optIn: sql<number>`count(*) filter (where exists (select 1 from ops.contact_consents k where k.contact_id = ${contacts.id} and k.opt_in))::int`,
      fromZiora: sql<number>`count(*) filter (where ${contacts.source} in ('demo_form','ziora_app','facebook_group','instagram'))::int`,
      leads: sql<number>`count(*) filter (where exists (select 1 from ops.contact_tags t where t.contact_id = ${contacts.id} and t.tag = 'lead'))::int`,
    }).from(contacts),
  ]);
  const ids = rows.map((r) => r.c.id);
  const [tagRows, demoRows] = ids.length
    ? await Promise.all([
        db.select().from(contactTags).where(inArray(contactTags.contactId, ids)),
        db.select({ contactId: demoRequests.contactId, stage: demoRequests.stage }).from(demoRequests).where(inArray(demoRequests.contactId, ids)),
      ])
    : [[], []];
  const tagsOf = (id: string) => tagRows.filter((t) => t.contactId === id).map((t) => t.tag);
  const eventOps = process.env.EVENT_OPS_URL ?? "https://event-ops-845770051786.us-central1.run.app";
  const pages = Math.ceil(total / PAGE);
  const qs = (p: number) => `/contacts?${new URLSearchParams(Object.entries({ ...sp, page: String(p), nuevo: undefined }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Ventas"
        title="Contactos"
        subtitle="Los contactos de Ziora Ops. Los de Event Ops no aparecen aquí: tráelos con Importar de Event Ops."
        actions={
          <>
          <Link href="/contacts/importar-event-ops" className={btn("secondary")}>Importar de Event Ops</Link>
          <Modal trigger="Importar hoja de leads" triggerClass={btn("secondary")} title="Importar hoja de leads (CSV)">
            <ActionForm action={importLeadsCsv}>
              <p className="text-sm text-muted">
                Descarga la pestaña de la hoja como CSV (Archivo → Descargar → .csv) y súbela tal cual. Se toman Prioridad, Segmento, Flag B2B,
                Nombre, Email, Teléfono, Rol, Pacientes/sem, Enfoque, Documentación, Usa IA, Ciudad y asistencia; las demás se ignoran.
                Basta con correo o teléfono.
              </p>
              <p className="text-xs text-faint">Si el contacto ya existe (mismo correo o teléfono), solo se completan los datos que falten. Nada de esto pasa a Event Ops.</p>
              <Field label="Archivo CSV"><input type="file" name="file" accept=".csv,text/csv" required className="text-sm" /></Field>
              <Field label="Base de consentimiento" hint="Con qué permiso los contactamos. Sin base no entran a campañas ni cadencias.">
                <Select name="consentSource" placeholder="Sin base de consentimiento" options={[["evento_luma", "Registro en Luma (Mexico Tech Week)"]]} />
              </Field>
              <Field label="Dueño de los leads nuevos">
                <Select name="ownerId" placeholder="Sin dueño" options={userOptions(users)} />
              </Field>
              <Field label="Enrolar en secuencia" hint="Solo entran los que quedan en Nuevo o Contactado. El primer correo sale en la siguiente corrida horaria (08:00–20:00 CDMX); los demás pasos, a las 10:00 del día que tocan.">
                <Select name="sequenceId" placeholder="Sin secuencia" options={activeSequences.map((s) => [s.id, s.name] as [string, string])} />
              </Field>
              <Submit>Importar</Submit>
            </ActionForm>
          </Modal>
          <Modal trigger="+ Contacto" title="Nuevo contacto" defaultOpen={sp.nuevo === "1"}>
            <ActionForm action={createContact}>
              <Field label="Nombre"><input name="name" required className={inputCls} placeholder="Psic. Nombre Apellido" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Correo"><input type="email" name="email" required className={inputCls} /></Field>
                <Field label="Teléfono / WhatsApp"><input name="phone" className={inputCls} /></Field>
                <Field label="Ciudad"><Select name="city" placeholder="—" options={Object.entries(CITY)} /></Field>
                <Field label="Origen"><Select name="source" defaultValue="manual" options={Object.entries(CONTACT_SOURCE)} /></Field>
              </div>
              <Field label="Etiquetas"><TagPicker selected={["psychologist"]} /></Field>
              <Field label="Notas"><textarea name="notes" rows={2} className={inputCls} /></Field>
              <div className="rounded-2xl border border-line bg-white p-3">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" name="optIn" className="h-4 w-4 accent-[#059669]" /> Tiene permiso para recibir correos
                </label>
                <input name="evidence" className={cn(inputCls, "mt-2")} placeholder="Evidencia: formulario de evento 12-oct, mensaje de WhatsApp…" />
              </div>
              <Submit>Guardar contacto</Submit>
            </ActionForm>
          </Modal>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["Contactos", stats.all, "Solo de Ziora Ops"],
          ["Psicólogos", stats.psych, "Etiqueta psicólogo/a"],
          ["Leads", stats.leads, "Etiqueta lead"],
          ["Con permiso de correo", stats.optIn, `${stats.all ? Math.round((stats.optIn / stats.all) * 100) : 0}% de la base`],
        ].map(([l, v, n]) => (
          <div key={l as string} className="card p-4">
            <p className="label">{l}</p>
            <p className="mt-1 text-2xl font-extrabold">{v}</p>
            <p className="text-[11px] text-muted">{n}</p>
          </div>
        ))}
      </div>

      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Nombre o correo" className={cn(inputCls, "w-56 rounded-full py-1.5")} />
        <Select name="tag" defaultValue={sp.tag} placeholder="Todas las etiquetas" className="w-auto rounded-full py-1.5 text-xs" options={Object.entries(CONTACT_TAG)} />
        <Select name="city" defaultValue={sp.city} placeholder="Todas las ciudades" className="w-auto rounded-full py-1.5 text-xs" options={Object.entries(CITY)} />
        <Select name="source" defaultValue={sp.source} placeholder="Todos los orígenes" className="w-auto rounded-full py-1.5 text-xs" options={Object.entries(CONTACT_SOURCE)} />
        <Select name="consent" defaultValue={sp.consent} placeholder="Permiso: todos" className="w-auto rounded-full py-1.5 text-xs" options={[["yes", "Con permiso"], ["no", "Sin permiso"]]} />
        <button className={btn("ghost", "sm")}>Filtrar</button>
        {Object.keys(sp).length > 0 && <Link href="/contacts" className="text-xs text-muted underline">Limpiar</Link>}
      </form>

      <Card>
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_auto] gap-3 border-b border-line px-5 py-2.5 md:grid">
          {["Contacto", "Ciudad · origen", "Etiquetas", "Correo marketing", ""].map((h) => <span key={h} className="label">{h}</span>)}
        </div>
        {rows.length === 0 && <p className="p-6 text-sm text-muted">Sin contactos con estos filtros.</p>}
        {rows.map(({ c, optIn, optedOutAt, evidence }) => {
          const tags = tagsOf(c.id);
          const demo = demoRows.find((d) => d.contactId === c.id);
          return (
            <Modal
              key={c.id}
              title={c.name}
              triggerClass="grid w-full grid-cols-1 gap-2 border-b border-[#EFEDE6] px-5 py-3 text-left last:border-b-0 hover:bg-[#FBFAF6] md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)_auto] md:items-center md:gap-3"
              trigger={
                <>
                  <span className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={c.name} size={32} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{c.name}</span>
                      <span className="block truncate text-xs text-muted">{c.email ?? "sin correo"}</span>
                    </span>
                  </span>
                  <span className="text-xs text-muted">
                    {c.cityName ?? (c.city ? CITY[c.city] : "—")} · {CONTACT_SOURCE[c.source] ?? c.source}
                    {c.jobTitle && <span className="mt-1 block truncate text-[11px] font-semibold text-ink">{c.jobTitle}</span>}
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {tags.slice(0, 4).map((t) => <Badge key={t} tone={(ZIORA_TAGS as readonly string[]).includes(t) ? "green" : "gray"}>{CONTACT_TAG[t] ?? t}</Badge>)}
                    {demo && <Badge tone="blue">Demo</Badge>}
                  </span>
                  <span>
                    {optedOutAt ? <Badge tone="red"><MailX className="mr-1 h-3 w-3" />Se dio de baja</Badge>
                      : optIn ? <Badge tone="green"><Mail className="mr-1 h-3 w-3" />Con permiso</Badge>
                      : <Badge tone="gray">Sin permiso</Badge>}
                  </span>
                  <span className="text-[11px] text-faint">{fmtDate(c.updatedAt)}</span>
                </>
              }
            >
              <div className="flex flex-col gap-5">
                <div className="flex flex-wrap gap-2 text-sm">
                  {c.email && <a href={`mailto:${c.email}`} className={btn("ghost", "sm")}><Mail className="h-3.5 w-3.5" />{c.email}</a>}
                  {c.phone && <span className={btn("ghost", "sm")}><Phone className="h-3.5 w-3.5" />{c.phone}</span>}
                  {c.eventOpsContactId && <a href={`${eventOps}/contacts/${c.eventOpsContactId}`} target="_blank" className={btn("secondary", "sm")}><Link2 className="h-3.5 w-3.5" />Ver origen en Event Ops</a>}
                  {c.leadStatus && <Link href={`/leads/${c.id}`} className={btn("primary", "sm")}>Ver ficha de lead</Link>}
                </div>
                {(c.jobTitle || c.patientsPerWeek || c.approach || c.documentation || c.aiUsage) && (
                  <div className="rounded-2xl border border-line bg-white p-4">
                    <p className="text-sm font-bold">Perfil del lead</p>
                    <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      {([
                        ["Rol", c.jobTitle], ["Pacientes/sem", c.patientsPerWeek], ["Enfoque", c.approach],
                        ["Documentación", c.documentation], ["Usa IA", c.aiUsage], ["Ciudad", c.cityName],
                      ] as [string, unknown][]).filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => (
                        <div key={k} className="min-w-0"><dt className="text-faint">{k}</dt><dd className="truncate font-semibold">{String(v)}</dd></div>
                      ))}
                    </dl>
                  </div>
                )}
                <ActionForm action={updateContact}>
                  <input type="hidden" name="id" value={c.id} />
                  <Field label="Nombre"><input name="name" defaultValue={c.name} className={inputCls} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Teléfono"><input name="phone" defaultValue={c.phone ?? ""} className={inputCls} /></Field>
                    <Field label="Ciudad"><Select name="city" defaultValue={c.city} placeholder="—" options={Object.entries(CITY)} /></Field>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Empresa o clínica"><input name="company" defaultValue={c.company ?? ""} className={inputCls} /></Field>
                    <Field label="Puesto"><input name="jobTitle" defaultValue={c.jobTitle ?? ""} className={inputCls} /></Field>
                  </div>
                  <Field label="Etiquetas"><TagPicker selected={tags} /></Field>
                  <Field label="Notas"><textarea name="notes" rows={2} defaultValue={c.notes ?? ""} className={inputCls} /></Field>
                  <Submit>Guardar cambios</Submit>
                </ActionForm>
                <DeleteButton kind="contact" id={c.id} what={`a ${c.name}`} warning="También se borra su permiso de correo y se quita de las cuentas donde aparece. Sus demos se quedan, sin el contacto." label="Eliminar contacto" />
                <div className="rounded-2xl border border-line bg-white p-4">
                  <p className="text-sm font-bold">Permiso de correo (LFPDPPP)</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {optedOutAt ? `Se dio de baja el ${fmtDate(optedOutAt, { dateStyle: "medium" })}. No se le puede volver a suscribir manualmente.`
                      : optIn ? `Con permiso. Evidencia: ${evidence ?? "—"}` : "Sin permiso registrado: no recibe campañas."}
                  </p>
                  {!optedOutAt && (
                    <ActionForm action={setConsent} className="mt-3 flex flex-col gap-2">
                      <input type="hidden" name="contactId" value={c.id} />
                      {optIn ? (
                        <>
                          <input type="hidden" name="optIn" value="no" />
                          <Submit variant="danger">Registrar baja</Submit>
                        </>
                      ) : (
                        <>
                          <input type="hidden" name="optIn" value="yes" />
                          <input name="evidence" required className={inputCls} placeholder="Cómo dio su permiso" />
                          <Submit variant="secondary">Registrar permiso</Submit>
                        </>
                      )}
                    </ActionForm>
                  )}
                </div>
              </div>
            </Modal>
          );
        })}
      </Card>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {page > 1 && <Link href={qs(page - 1)} className={btn("ghost", "sm")}>← Anterior</Link>}
          <span className="text-muted">Página {page} de {pages} · {total} contactos</span>
          {page < pages && <Link href={qs(page + 1)} className={btn("ghost", "sm")}>Siguiente →</Link>}
        </div>
      )}
    </div>
  );
}
