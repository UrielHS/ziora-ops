import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { CommunityStatusBadge, GeneratePost, MembershipButtons, PostCard, PromoPolicyForm, ReviewForm } from "@/components/communities";
import { Badge, btn, Card, PageHeader, PanelHeader } from "@/components/ui";
import { db } from "@/db";
import { baseMessages, communities, communityMemberships, communityPosts } from "@/db/schema";
import { users } from "@/db/shared";
import { postBlockReason } from "@/domain/community-queue";
import { renderMessage } from "@/domain/community-posts";
import { COMMUNITY_PLATFORM, COMMUNITY_PROMO_POLICY } from "@/lib/labels";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? full;

export default async function CommunityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const access = await requirePagePermission("communities.operate");
  const [c] = await db.select().from(communities).where(eq(communities.id, id));
  if (!c) notFound();

  const [[mine], posts, messages, [m0], [reviewer]] = await Promise.all([
    db.select({ status: communityMemberships.status }).from(communityMemberships)
      .where(and(eq(communityMemberships.communityId, id), eq(communityMemberships.userId, access.user.id))),
    db.select({ p: communityPosts, who: users.name }).from(communityPosts)
      .leftJoin(users, eq(users.id, communityPosts.publisherId)).where(eq(communityPosts.communityId, id)).orderBy(desc(communityPosts.createdAt)),
    db.select({ key: baseMessages.key }).from(baseMessages).where(and(eq(baseMessages.status, "aprobado"), eq(baseMessages.isPost, true))).orderBy(baseMessages.key),
    db.select({ body: baseMessages.body }).from(baseMessages).where(eq(baseMessages.key, "M0")),
    c.reviewedBy ? db.select({ name: users.name }).from(users).where(eq(users.id, c.reviewedBy)) : Promise.resolve([] as { name: string }[]),
  ]);
  const lastPublished = posts.filter((r) => r.p.status === "publicado" && r.p.publishedAt).map((r) => r.p.publishedAt!).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const reason = postBlockReason(c, mine?.status ?? null, lastPublished, new Date());
  // El M0 lleva el nombre de quien escribe; {admin} se deja para que se ponga a mano el nombre del admin.
  const adminMessage = m0 ? renderMessage(m0.body, { nombre: firstName(access.user.name) }) : null;
  const info = ([
    ["País", c.country], ["Ciudad o región", c.cityRegion], ["Tema", c.topic], ["Tamaño", c.sizeApprox], ["Acceso", c.accessType],
    ["Actividad", c.activity], ["Fase", c.phase], ["Recomendada por", c.recommendedBy], ["Notas", c.notes],
  ] as [string, string | number | null][]).filter(([, v]) => v !== null && v !== "");

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Marketing · Comunidades"
        title={c.name}
        subtitle={[COMMUNITY_PLATFORM[c.platform], c.kind === "alianza" ? "Alianza" : null, COMMUNITY_PROMO_POLICY[c.promoPolicy]].filter(Boolean).join(" · ")}
        actions={<><Link href="/communities" className={btn("ghost", "sm")}>← Comunidades</Link><Link href="/communities/publicar" className={btn("ghost", "sm")}>Publicar</Link></>}
      />
      <div className="flex flex-wrap items-center gap-2">
        <CommunityStatusBadge status={c.status} />
        {c.priority && <Badge tone={c.priority === "A" ? "green" : "gray"}>Prioridad {c.priority}</Badge>}
        {c.discardReason && <Badge tone="red">Descartada: {c.discardReason}</Badge>}
        {reviewer && <span className="text-xs text-muted">Revisó {reviewer.name}</span>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col gap-5">
          <Card>
            <PanelHeader title="Datos" />
            <dl className="grid grid-cols-1 gap-x-4 gap-y-2 px-5 pb-5 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2"><dt className="label">Liga</dt><dd className="break-all"><a href={c.url} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">{c.url}</a></dd></div>
              {info.map(([k, v]) => <div key={k}><dt className="label">{k}</dt><dd className="whitespace-pre-wrap">{v}</dd></div>)}
            </dl>
          </Card>

          {(c.status === "por_revisar" || c.status === "descartada") && (
            <Card>
              <PanelHeader title="Revisión" subtitle="Abre el grupo, mira si es de psicólogos y si permite promoción antes de aprobarlo." />
              <div className="px-5 pb-5 pt-3"><ReviewForm id={c.id} /></div>
            </Card>
          )}

          <Card>
            <PanelHeader title="Mi membresía" />
            <div className="px-5 pb-5 pt-3"><MembershipButtons communityId={c.id} url={c.url} status={mine?.status ?? null} /></div>
          </Card>

          <Card>
            <PanelHeader title="Política de promoción" subtitle="Lee las reglas del grupo y registra si permiten compartir una invitación." />
            <div className="px-5 pb-5 pt-3">
              <PromoPolicyForm communityId={c.id} policy={c.promoPolicy} rulesText={c.rulesText} adminMessage={adminMessage} />
              {c.promoPolicy === "permiso_admin" && <p className="mt-2 text-xs text-muted">Sustituye {"{admin}"} por el nombre del admin antes de enviarlo. Cuando responda que sí, cambia la política a «Permite promoción».</p>}
            </div>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <PanelHeader title="Generar post" subtitle="Crea tu post con tu liga corta. Luego cópialo y publícalo en el grupo." />
            <div className="px-5 pb-5 pt-3"><GeneratePost communityId={c.id} keys={messages.map((m) => m.key)} reason={reason} /></div>
          </Card>
          <Card>
            <PanelHeader title="Posts del grupo" subtitle={`${posts.length} post(s)`} />
            <div className="flex flex-col gap-3 px-5 pb-5 pt-3">
              {posts.length === 0 && <p className="text-sm text-muted">Todavía no hay posts en este grupo.</p>}
              {posts.map(({ p, who }) => (
                <div key={p.id} className="flex flex-col gap-1">
                  {who && <p className="text-xs text-muted">{who}</p>}
                  <PostCard post={p} canDelete canAct={p.publisherId === access.user.id} />
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
