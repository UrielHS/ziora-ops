import Link from "next/link";
import { asc, desc, gte, or, isNull } from "drizzle-orm";
import { createCampaign } from "@/actions/campaigns";
import { Card, Field, inputCls, PageHeader, Select } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ui/form";
import { db } from "@/db";
import { emailTemplates } from "@/db/schema";
import { events } from "@/db/shared";
import { fmtDate, todayISO } from "@/lib/format";
import { CITY, CONTACT_SOURCE, CONTACT_TAG } from "@/lib/labels";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

function Chips({ name, options, selected = [] }: { name: string; options: [string, string][]; selected?: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <label key={v} className="cursor-pointer">
          <input type="checkbox" name={`${name}[]`} value={v} defaultChecked={selected.includes(v)} className="peer sr-only" />
          <span className="pill border border-line bg-white text-muted peer-checked:border-emerald/40 peer-checked:bg-mint peer-checked:text-emerald">{l}</span>
        </label>
      ))}
    </div>
  );
}

export default async function NewCampaignPage({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  await requirePagePermission("content.manage");
  const sp = await searchParams;
  const [templates, evs] = await Promise.all([
    db.select({ id: emailTemplates.id, name: emailTemplates.name }).from(emailTemplates).orderBy(desc(emailTemplates.updatedAt)),
    db.select().from(events).where(or(gte(events.date, todayISO()), isNull(events.date))).orderBy(asc(events.date)),
  ]);
  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <PageHeader eyebrow="Campañas" title="Nueva campaña" actions={<Link href="/campaigns" className="text-sm text-muted underline">Volver</Link>} />
      <Card className="p-6">
        <ActionForm action={createCampaign} className="flex flex-col gap-5">
          <Field label="Nombre interno"><input name="name" required className={inputCls} placeholder="Invitación Demo Night · psicólogos CDMX" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Plantilla"><Select name="templateId" placeholder="Elige…" defaultValue={templates[0]?.id} options={templates.map((t) => [t.id, t.name])} /></Field>
            <Field label="Asunto (opcional)" hint="Si lo dejas vacío usa el de la plantilla"><input name="subject" className={inputCls} /></Field>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4">
            <p className="text-sm font-bold">Segmento</p>
            <p className="mb-3 text-xs text-muted">Filtros sobre los contactos de Ziora Ops. Siempre se excluye a quien no tiene permiso o se dio de baja.</p>
            <div className="flex flex-col gap-4">
              <Field label="Etiquetas (cualquiera)"><Chips name="tags" selected={["psychologist"]} options={["psychologist", "lead", "clinic", "ziora_user", "attendee", "speaker", "university"].map((t) => [t, CONTACT_TAG[t]])} /></Field>
              <Field label="Ciudades"><Chips name="cities" options={Object.entries(CITY).filter(([k]) => k !== "tbd") as [string, string][]} /></Field>
              <Field label="Origen"><Chips name="sources" options={Object.entries(CONTACT_SOURCE)} /></Field>
              <Field label="Evento de Event Ops (opcional)" hint="Limita a asistentes de ese evento que ya importaste de Event Ops y habilita {{evento}} en la plantilla">
                <Select name="eventId" defaultValue={sp.event} placeholder="Sin evento" options={evs.map((e) => [e.id, `${e.name} · ${fmtDate(e.date)}`])} />
              </Field>
            </div>
          </div>
          <Field label="Programar (opcional, hora CDMX)"><input type="datetime-local" name="scheduledAt" className={inputCls} /></Field>
          <Submit>Crear y revisar</Submit>
        </ActionForm>
      </Card>
    </div>
  );
}
