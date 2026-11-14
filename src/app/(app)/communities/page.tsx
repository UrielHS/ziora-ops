import Link from "next/link";
import { and, eq, ilike, sql, type SQL } from "drizzle-orm";
import { CommunityStatusBadge, NewCommunityButton } from "@/components/communities";
import { Badge, btn, Card, cn, Empty, inputCls, PageHeader, Select } from "@/components/ui";
import { SortControl } from "@/components/ui/sort";
import { parseCount, resolveSort, sortRows, type SortValue } from "@/lib/sort";
import { db } from "@/db";
import { communities, communityMemberships } from "@/db/schema";
import { COMMUNITY_PLATFORM, COMMUNITY_PROMO_POLICY, COMMUNITY_STATUS, MEMBERSHIP_STATUS } from "@/lib/labels";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";
type SP = { estado?: string; plataforma?: string; fase?: string; prioridad?: string; q?: string; orden?: string; dir?: string };
const SORT_OPTIONS = [["prioridad", "Prioridad"], ["nombre", "Nombre"], ["tamano", "Tamaño"], ["alta", "Fecha de alta"]] as const;
const SORT_KEYS = SORT_OPTIONS.map(([k]) => k);
const TEXT_KEYS = ["prioridad", "nombre"] as const;
type Row = typeof communities.$inferSelect;

export default async function CommunitiesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const access = await requirePagePermission("communities.operate");
  const sp = await searchParams;
  // Por defecto: lo que falta revisar de la fase 1. «todos»/«todas» quitan el filtro.
  const estado = sp.estado ?? "por_revisar";
  const fase = sp.fase ?? "1";
  const where: SQL[] = [];
  if (estado in COMMUNITY_STATUS) where.push(eq(communities.status, estado as Row["status"]));
  if (sp.plataforma && sp.plataforma in COMMUNITY_PLATFORM) where.push(eq(communities.platform, sp.plataforma as Row["platform"]));
  if (fase !== "todas" && Number.isInteger(Number(fase))) where.push(eq(communities.phase, Number(fase)));
  if (sp.prioridad && ["A", "B", "C"].includes(sp.prioridad)) where.push(eq(communities.priority, sp.prioridad));
  if (sp.q?.trim()) where.push(ilike(communities.name, `%${sp.q.trim()}%`));

  const found = await db
    .select({ c: communities, mine: communityMemberships.status })
    .from(communities)
    .leftJoin(communityMemberships, and(eq(communityMemberships.communityId, communities.id), eq(communityMemberships.userId, access.user.id)))
    .where(where.length ? and(...where) : undefined)
    .orderBy(sql`${communities.priority} nulls last`, communities.name)
    .limit(300);
  const sort = resolveSort(sp, { keys: SORT_KEYS, def: "prioridad", textKeys: TEXT_KEYS });
  const sortValue = ({ c }: (typeof found)[number]): SortValue =>
    sort.key === "nombre" ? c.name : sort.key === "tamano" ? parseCount(c.sizeApprox) : sort.key === "alta" ? c.createdAt : c.priority;
  const rows = sortRows(found, sort.dir, sortValue);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Marketing · Comunidades"
        title="Comunidades"
        subtitle="Revisa cada grupo antes de unirte: solo se publica donde el grupo lo permite."
        actions={<><Link href="/communities/publicar" className={btn("ghost", "sm")}>Ir a publicar</Link><NewCommunityButton /></>}
      />
      <form className="flex flex-wrap items-center gap-2">
        <input name="q" defaultValue={sp.q} placeholder="Nombre del grupo" aria-label="Buscar comunidad" className={cn(inputCls, "w-52 rounded-full py-1.5")} />
        <Select name="estado" defaultValue={estado} className="w-auto rounded-full py-1.5 text-xs" options={[["todos", "Todos los estados"], ...Object.entries(COMMUNITY_STATUS)]} />
        <Select name="plataforma" defaultValue={sp.plataforma} placeholder="Todas las plataformas" className="w-auto rounded-full py-1.5 text-xs" options={Object.entries(COMMUNITY_PLATFORM)} />
        <Select name="fase" defaultValue={fase} className="w-auto rounded-full py-1.5 text-xs" options={[["todas", "Todas las fases"], ["1", "Fase 1"], ["2", "Fase 2"], ["3", "Fase 3"]]} />
        <Select name="prioridad" defaultValue={sp.prioridad} placeholder="Toda prioridad" className="w-auto rounded-full py-1.5 text-xs" options={[["A", "Prioridad A"], ["B", "Prioridad B"], ["C", "Prioridad C"]]} />
        {sp.orden && <input type="hidden" name="orden" value={sp.orden} />}
        {sp.dir && <input type="hidden" name="dir" value={sp.dir} />}
        <button className={btn("ghost", "sm")}>Filtrar</button>
        <span className="text-xs text-muted">{rows.length} {rows.length === 1 ? "comunidad" : "comunidades"}</span>
        <span className="ml-auto"><SortControl options={SORT_OPTIONS} current={sort.key} dir={sort.dir} textKeys={TEXT_KEYS} /></span>
      </form>
      {rows.length === 0 ? (
        <Empty title="No hay comunidades con estos filtros" text="Cambia el estado o la fase, o agrega una comunidad." />
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {rows.map(({ c, mine }) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3">
                <Link href={`/communities/${c.id}`} className="min-w-0 flex-1 text-sm font-bold hover:underline">{c.name}</Link>
                <Badge tone="gray">{COMMUNITY_PLATFORM[c.platform]}</Badge>
                {c.priority && <Badge tone={c.priority === "A" ? "green" : "gray"}>{c.priority}</Badge>}
                <span className="text-xs text-muted">{c.sizeApprox ?? ""}</span>
                <span className="text-xs text-muted">{COMMUNITY_PROMO_POLICY[c.promoPolicy]}</span>
                {mine && <Badge tone={mine === "unida" ? "green" : "gray"}>Yo: {MEMBERSHIP_STATUS[mine]}</Badge>}
                <CommunityStatusBadge status={c.status} />
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
