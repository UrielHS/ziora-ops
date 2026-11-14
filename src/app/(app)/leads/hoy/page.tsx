import Link from "next/link";
import { and, eq, isNotNull, notInArray, type SQL } from "drizzle-orm";
import { CadenceBadge, LeadPriorityBadge, LeadStatusBadge, TodayRow } from "@/components/leads";
import { DmCounter, SocialTodayRow } from "@/components/social-leads";
import { btn, Card, cn, Empty, PageHeader, PanelHeader } from "@/components/ui";
import { SortControl } from "@/components/ui/sort";
import { LEAD_SORT_OPTIONS, LEAD_SORT_TEXT, resolveLeadSort, sortLeads } from "@/domain/lead-sort";
import { hrefWith } from "@/lib/sort";
import { db } from "@/db";
import { listUsers } from "@/db/queries";
import { contacts } from "@/db/schema";
import { shortLink } from "@/domain/community-posts";
import { defaultMessage, todayBuckets } from "@/domain/leads";
import { dmCounts, dmFor, dmLead, dmsSentToday, loadDmMessages } from "@/domain/social-dm";
import { loadLinks } from "@/domain/social-links";
import { can } from "@/lib/permissions";
import { waMessageLink } from "@/domain/phone";
import { loadCadence } from "@/domain/sequences";
import { todayISO } from "@/lib/format";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";


// Filtro rápido por tipo de lead: los de redes se trabajan por DM y los demás por WhatsApp o correo.
const KIND = [["", "Todos"], ["psicologo", "Redes: psicólogos"], ["influencer", "Redes: influencers"], ["otros", "WhatsApp y correo"]] as const;

export default async function LeadsTodayPage({ searchParams }: { searchParams: Promise<{ todos?: string; tipo?: string; orden?: string; dir?: string }> }) {
  const access = await requirePagePermission("leads.view");
  const sp = await searchParams;
  const mineOnly = sp.todos !== "1";
  const today = todayISO();
  const in7 = new Date(`${today}T12:00:00`);
  in7.setDate(in7.getDate() + 7);
  const weekEnd = in7.toISOString().slice(0, 10);

  const where: SQL[] = [isNotNull(contacts.leadStatus), notInArray(contacts.leadStatus, ["pago", "perdido"])];
  if (mineOnly) where.push(eq(contacts.ownerId, access.user.id));
  const [users, allRows] = await Promise.all([listUsers(), db.select().from(contacts).where(and(...where))]);
  const rows = allRows.filter((c) =>
    sp.tipo === "psicologo" || sp.tipo === "influencer" ? !!c.socialHandle && c.socialLeadType === sp.tipo
    : sp.tipo === "otros" ? !c.socialHandle : true);
  const cadence = await loadCadence(db, rows.map((r) => r.id));

  // Leads de redes: contadores, ligas y mensajes R* se cargan una sola vez (nada de consultas por fila).
  const socialIds = rows.filter((r) => r.socialHandle).map((r) => r.id);
  const [sentCounts, links, dmMessages, sentToday] = await Promise.all([
    dmCounts(db, socialIds), loadLinks(db, socialIds), loadDmMessages(db), dmsSentToday(db, access.user.id),
  ]);
  const canManage = can(access, "leads.manage");
  const myFirstName = access.user.name.trim().split(/\s+/)[0] ?? access.user.name;

  const ownerName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const buckets = todayBuckets(rows, cadence, today, weekEnd);
  // Sin orden elegido se respeta el de cada grupo (vencidos primero); con orden, se aplica dentro de cada grupo.
  const sort = resolveLeadSort(sp);
  const ordered = (list: typeof rows) => (sp.orden ? sortLeads(list, sort, ownerName) : list);
  const due = ordered(buckets.due), soon = ordered(buckets.soon), noPlan = ordered(buckets.noPlan), inSequence = ordered(buckets.inSequence);
  const row = (c: typeof rows[number]) => {
    if (c.socialHandle) {
      const invite = links.get(c.id)?.invite;
      const dm = dmFor(dmLead(c), sentCounts.get(c.id) ?? 0, dmMessages, { yo: myFirstName, liga: invite ? shortLink(invite.code) : "" });
      // Mi día solo lee: sin liga no hay texto copiable; la ficha (con permiso de gestión) la genera.
      return <SocialTodayRow key={c.id} c={c} owner={ownerName(c.ownerId)} dm={dm} canManage={canManage} noLink={!invite} />;
    }
    const cad = cadence.get(c.id);
    // Si la secuencia dejó un WhatsApp listo, el enlace de WhatsApp lleva ese texto.
    const message = cad?.status === "activa" && cad.pendingText ? cad.pendingText : defaultMessage(c, access.user.name);
    return <TodayRow key={c.id} c={c} owner={ownerName(c.ownerId)} message={message} wa={c.phoneInvalidAt ? null : waMessageLink(c.phoneE164, message)} cadence={cad} />;
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Ventas · Leads"
        title="Mi día"
        subtitle={mineOnly ? "Tus leads con algo que hacer hoy. Mensaje listo para copiar o abrir en WhatsApp; registra el toque y pasa al siguiente." : "Todos los leads del equipo con algo que hacer."}
        actions={
          <>
            <Link href={hrefWith("/leads/hoy", sp, { todos: mineOnly ? "1" : undefined })} className={btn("ghost", "sm")}>{mineOnly ? "Ver los de todos" : "Solo los míos"}</Link>
            <Link href="/leads/secuencias" className={btn("ghost", "sm")}>Secuencias</Link>
            <Link href="/leads" className={btn("secondary", "sm")}>Todos los leads</Link>
          </>
        }
      />

      {(socialIds.length > 0 || sentToday > 0) && <DmCounter sent={sentToday} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Tipo de lead" className="flex flex-wrap gap-1.5">
          {KIND.map(([v, label]) => {
            const on = (sp.tipo ?? "") === v;
            return (
              <Link key={v || "todos"} href={hrefWith("/leads/hoy", sp, { tipo: v || undefined })} aria-current={on ? "true" : undefined}
                className={cn("rounded-full border px-3 py-1.5 text-xs font-semibold", on ? "border-forest bg-forest text-white" : "border-line bg-white text-muted hover:text-ink")}>
                {label}
              </Link>
            );
          })}
        </nav>
        <SortControl options={LEAD_SORT_OPTIONS} current={sp.orden ? sort.key : ""} dir={sort.dir} textKeys={LEAD_SORT_TEXT} defaultLabel="Lo más urgente" />
      </div>

      {due.length + soon.length + noPlan.length + inSequence.length === 0 && (
        <Empty title="Nada pendiente" text={mineOnly ? "No tienes leads con siguiente paso para hoy. Toma leads sin dueño en el kanban o revisa los de todos." : "Nadie tiene leads con siguiente paso pendiente."} action={<Link href="/leads" className={btn("primary", "sm")}>Ir al kanban</Link>} />
      )}

      {due.length > 0 && (
        <Card>
          <PanelHeader title="Hoy y atrasados" subtitle={`${due.length} lead(s). Los vencidos van primero.`} />
          <div className="mt-2">{due.map(row)}</div>
        </Card>
      )}
      {soon.length > 0 && (
        <Card>
          <PanelHeader title="Próximos 7 días" subtitle={`${soon.length} lead(s)`} />
          <div className="mt-2">{soon.map(row)}</div>
        </Card>
      )}
      {noPlan.length > 0 && (
        <Card>
          <PanelHeader title="Sin siguiente paso" subtitle={`${noPlan.length} lead(s) en trabajo sin fecha. Ponles una desde la ficha o mándales algo hoy.`} />
          <div className="mt-2">{noPlan.map(row)}</div>
        </Card>
      )}
      {inSequence.length > 0 && (
        <Card>
          <PanelHeader title="En secuencia" subtitle={`${inSequence.length} lead(s) cubiertos por una cadencia: el sistema manda el siguiente correo o te deja el WhatsApp aquí cuando toque.`} />
          <ul className="mt-2 flex flex-col">
            {inSequence.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 border-b border-[#EFEDE6] px-5 py-2.5 text-sm last:border-b-0">
                <Link href={`/leads/${c.id}`} className="font-bold hover:underline">{c.name}</Link>
                <LeadPriorityBadge priority={c.priority} />
                <LeadStatusBadge status={c.leadStatus} />
                <CadenceBadge cadence={cadence.get(c.id)} />
                <span className="ml-auto text-xs text-muted">{ownerName(c.ownerId) ?? "Sin dueño"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
