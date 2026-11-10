import Link from "next/link";
import { and, eq, exists, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import { bulkLeadsAction } from "@/actions/leads";
import { LeadCard, LeadsBoard } from "@/components/leads";
import { SelectAll } from "@/components/select-all";
import { btn, Card, cn, inputCls, PageHeader, PanelHeader, Select } from "@/components/ui";
import { ActionForm, Submit } from "@/components/ui/form";
import { db } from "@/db";
import { listUsers, userOptions } from "@/db/queries";
import { cityEnum, contacts, contactSourceEnum, contactTagEnum, contactTags, sequences } from "@/db/schema";
import { LEAD_ORDER, ownerFilter } from "@/domain/leads";
import { appReportsReferrals, referralsBySeller } from "@/domain/referrals";
import { todayISO } from "@/lib/format";
import { CITY, CONTACT_SOURCE, CONTACT_TAG, LEAD_PRIORITY, LEAD_STATUS } from "@/lib/labels";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";
type SP = { todos?: string; prioridad?: string; origen?: string; etiqueta?: string; ciudad?: string; q?: string; dueno?: string };

const ACCENT: Record<string, string> = {
  nuevo: "bg-faint", contactado: "bg-[#1D5FA8]", respondio: "bg-[#6B4FA8]", demo_agendada: "bg-[#1D5FA8]", en_trial: "bg-[#D99A2B]", pago: "bg-emerald", perdido: "bg-danger",
};

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const access = await requirePagePermission("leads.view");
  const canManage = can(access, "leads.manage");
  const sp = await searchParams;
  const hoy = todayISO();

  const where: SQL[] = [isNotNull(contacts.leadStatus)];
  // Por defecto: mis leads y los que nadie ha tomado. "todos=1" muestra el embudo completo.
  const owner = ownerFilter(sp.dueno);
  if (owner.kind === "none") where.push(isNull(contacts.ownerId));
  else if (owner.kind === "user") where.push(eq(contacts.ownerId, owner.id));
  else if (sp.todos !== "1") where.push(or(eq(contacts.ownerId, access.user.id), isNull(contacts.ownerId))!);
  if (sp.prioridad) where.push(eq(contacts.priority, Number(sp.prioridad)));
  if (sp.origen) where.push(eq(contacts.source, sp.origen as (typeof contactSourceEnum.enumValues)[number]));
  if (sp.ciudad) where.push(eq(contacts.city, sp.ciudad as (typeof cityEnum.enumValues)[number]));
  if (sp.etiqueta) where.push(exists(db.select({ x: sql`1` }).from(contactTags).where(and(eq(contactTags.contactId, contacts.id), eq(contactTags.tag, sp.etiqueta as (typeof contactTagEnum.enumValues)[number])))));
  if (sp.q) where.push(or(ilike(contacts.name, `%${sp.q}%`), ilike(contacts.email, `%${sp.q}%`), ilike(contacts.company, `%${sp.q}%`))!);

  const [users, rows, [k], activeSequences] = await Promise.all([
    listUsers(),
    db.select().from(contacts).where(and(...where)).orderBy(sql`${contacts.priority} nulls last`, sql`${contacts.nextActionOn} nulls last`, contacts.updatedAt),
    db.select({
      total: sql<number>`count(*)::int`,
      hoy: sql<number>`count(*) filter (where ${contacts.nextActionOn} <= ${hoy} and ${contacts.leadStatus} not in ('pago','perdido'))::int`,
      respondieron: sql<number>`count(*) filter (where exists (select 1 from ops.contact_activities a where a.contact_id = ${contacts.id} and a.type = 'cambio_estado' and a.meta->>'to' = 'respondio' and a.occurred_at >= now() - interval '7 days'))::int`,
      trial: sql<number>`count(*) filter (where ${contacts.leadStatus} = 'en_trial')::int`,
      pago: sql<number>`count(*) filter (where ${contacts.leadStatus} = 'pago')::int`,
    }).from(contacts).where(isNotNull(contacts.leadStatus)),
    db.select({ id: sequences.id, name: sequences.name }).from(sequences).where(eq(sequences.active, true)).orderBy(sequences.name),
  ]);
  const ownerName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const columns = [
    ...LEAD_ORDER.map((s) => ({ id: s, label: LEAD_STATUS[s].label, accent: ACCENT[s] })),
    { id: "perdido", label: LEAD_STATUS.perdido.label, accent: ACCENT.perdido },
  ];
  const kpis: [string, number, string][] = [
    ["Leads", k.total, "Con estado en el embudo"],
    ["Pendientes hoy", k.hoy, "Siguiente paso vencido o para hoy"],
    ["Respondieron", k.respondieron, "Últimos 7 días"],
    ["En trial", k.trial, "Probando Ziora"],
    ["Pagaron", k.pago, "Clientes"],
  ];

  const [referrals, appReports] = canManage ? await Promise.all([referralsBySeller(db), appReportsReferrals(db)]) : [[], false];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Ventas"
        title="Leads"
        subtitle="Cada tarjeta es una persona con la que hay que hablar. Arrastra para cambiar de etapa; el motivo de pérdida se captura en la ficha."
        actions={
          <>
            <Link href="/leads/secuencias" className={btn("ghost", "sm")}>Secuencias</Link>
            <Link href="/leads/hoy" className={btn("primary")}>Mi día</Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {kpis.map(([l, v, n]) => (
          <div key={l} className="card p-4">
            <p className="label">{l}</p>
            <p className="mt-1 text-2xl font-extrabold">{v}</p>
            <p className="text-[11px] text-muted">{n}</p>
          </div>
        ))}
      </div>

      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Nombre, correo o empresa" className={cn(inputCls, "w-56 rounded-full py-1.5")} />
        <Select name="prioridad" defaultValue={sp.prioridad} placeholder="Toda prioridad" className="w-auto rounded-full py-1.5 text-xs" options={Object.entries(LEAD_PRIORITY).map(([k, v]) => [k, v.label])} />
        <Select name="origen" defaultValue={sp.origen} placeholder="Todos los orígenes" className="w-auto rounded-full py-1.5 text-xs" options={Object.entries(CONTACT_SOURCE)} />
        <Select name="etiqueta" defaultValue={sp.etiqueta} placeholder="Todas las etiquetas" className="w-auto rounded-full py-1.5 text-xs" options={Object.entries(CONTACT_TAG)} />
        <Select name="ciudad" defaultValue={sp.ciudad} placeholder="Todas las ciudades" className="w-auto rounded-full py-1.5 text-xs" options={Object.entries(CITY)} />
        <Select name="dueno" defaultValue={sp.dueno} placeholder="Cualquier dueño" className="w-auto rounded-full py-1.5 text-xs" options={[["ninguno", "Sin dueño"], ...userOptions(users)]} />
        <label className="flex items-center gap-1.5 text-xs font-semibold text-muted">
          <input type="checkbox" name="todos" value="1" defaultChecked={sp.todos === "1"} className="h-3.5 w-3.5 accent-emerald" />
          Ver todos, no solo los míos
        </label>
        <button className={btn("ghost", "sm")}>Filtrar</button>
        {Object.keys(sp).length > 0 && <Link href="/leads" className="text-xs text-muted underline">Limpiar</Link>}
      </form>

      <ActionForm action={bulkLeadsAction} className="flex flex-col gap-3">
        {canManage && (
          <Card className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <SelectAll name="ids[]" label="Seleccionar todos" />
            <span className="h-5 w-px bg-line" />
            <Select name="ownerId" placeholder="Sin dueño" className="w-auto py-1.5 text-xs" options={userOptions(users)} />
            <Submit variant="secondary" name="op" value="owner" className="!py-1.5 !text-xs">Asignar dueño</Submit>
            <span className="h-5 w-px bg-line" />
            <Select name="priority" placeholder="Sin prioridad" className="w-auto py-1.5 text-xs" options={Object.entries(LEAD_PRIORITY).map(([k, v]) => [k, v.label])} />
            <Submit variant="secondary" name="op" value="priority" className="!py-1.5 !text-xs">Cambiar prioridad</Submit>
            {activeSequences.length > 0 && (
              <>
                <span className="h-5 w-px bg-line" />
                <Select name="sequenceId" placeholder="Secuencia…" className="w-auto py-1.5 text-xs" options={activeSequences.map((s) => [s.id, s.name] as [string, string])} />
                <Submit variant="secondary" name="op" value="enroll" className="!py-1.5 !text-xs">Enrolar en secuencia</Submit>
              </>
            )}
          </Card>
        )}
        <LeadsBoard
          columns={columns}
          canManage={canManage}
          items={rows.map((c) => ({ id: c.id, column: c.leadStatus!, node: <LeadCard c={c} owner={ownerName(c.ownerId)} selectable={canManage} /> }))}
        />
      </ActionForm>
      {rows.length === 0 && <p className="text-sm text-muted">Sin leads con estos filtros. Importa la hoja desde Contactos o quita el filtro &quot;solo los míos&quot;.</p>}

      {canManage && (
        <Card>
          <PanelHeader title="Referidos por vendedor" subtitle="Terapeutas que se registraron en la app con el código de referido de cada quien, y cuántos ya pagan." />
          {!appReports ? (
            <p className="px-5 pb-5 text-sm text-muted">La app aún no reporta referidos. En cuanto mande el código con cada usuario, aquí sale el conteo por vendedor.</p>
          ) : referrals.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted">Nadie tiene liga de referido en su perfil. Cada quien la pone en Ajustes → Mi perfil de vendedor.</p>
          ) : (
            <ul className="grid gap-2 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
              {referrals.map((r) => (
                <li key={r.userId} className="rounded-2xl border border-line bg-[#FBFAF6] px-4 py-3">
                  <p className="truncate font-semibold">{r.name}</p>
                  <p className="text-xs text-muted">{r.code}</p>
                  <p className="mt-1 text-sm"><span className="text-xl font-semibold">{r.signups}</span> registros · <span className="font-semibold text-emerald">{r.paying}</span> pagan</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
