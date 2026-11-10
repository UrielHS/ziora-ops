import Link from "next/link";
import { and, eq, isNotNull, notInArray, type SQL } from "drizzle-orm";
import { CadenceBadge, LeadPriorityBadge, LeadStatusBadge, TodayRow } from "@/components/leads";
import { btn, Card, Empty, PageHeader, PanelHeader } from "@/components/ui";
import { db } from "@/db";
import { listUsers } from "@/db/queries";
import { contacts } from "@/db/schema";
import { defaultMessage, todayBuckets } from "@/domain/leads";
import { waMessageLink } from "@/domain/phone";
import { loadCadence } from "@/domain/sequences";
import { todayISO } from "@/lib/format";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";


export default async function LeadsTodayPage({ searchParams }: { searchParams: Promise<{ todos?: string }> }) {
  const access = await requirePagePermission("leads.view");
  const sp = await searchParams;
  const mineOnly = sp.todos !== "1";
  const today = todayISO();
  const in7 = new Date(`${today}T12:00:00`);
  in7.setDate(in7.getDate() + 7);
  const weekEnd = in7.toISOString().slice(0, 10);

  const where: SQL[] = [isNotNull(contacts.leadStatus), notInArray(contacts.leadStatus, ["pago", "perdido"])];
  if (mineOnly) where.push(eq(contacts.ownerId, access.user.id));
  const [users, rows] = await Promise.all([listUsers(), db.select().from(contacts).where(and(...where))]);
  const cadence = await loadCadence(db, rows.map((r) => r.id));

  const { due, soon, noPlan, inSequence } = todayBuckets(rows, cadence, today, weekEnd);
  const ownerName = (id: string | null) => users.find((u) => u.id === id)?.name ?? null;
  const row = (c: typeof rows[number]) => {
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
            <Link href={mineOnly ? "/leads/hoy?todos=1" : "/leads/hoy"} className={btn("ghost", "sm")}>{mineOnly ? "Ver los de todos" : "Solo los míos"}</Link>
            <Link href="/leads/secuencias" className={btn("ghost", "sm")}>Secuencias</Link>
            <Link href="/leads" className={btn("secondary", "sm")}>Kanban</Link>
          </>
        }
      />

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
          <PanelHeader title="Sin siguiente paso" subtitle="Leads en trabajo sin fecha. Ponles una desde la ficha o mándales algo hoy." />
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
