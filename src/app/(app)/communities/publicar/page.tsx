import Link from "next/link";
import { MembershipButtons, PostCard, PublishQueue } from "@/components/communities";
import { Badge, btn, Card, PageHeader, PanelHeader } from "@/components/ui";
import { db } from "@/db";
import { loadPublisherView, WEEKLY_POSTS_PER_PUBLISHER } from "@/domain/community-queue";
import { COMMUNITY_PLATFORM } from "@/lib/labels";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

const EMPTY = "rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted";

export default async function PublishPage() {
  const access = await requirePagePermission("communities.operate");
  const v = await loadPublisherView(db, access.user.id);
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Marketing · Comunidades"
        title="Publicar"
        subtitle={`Un clic copia el texto con tu liga y abre el grupo. Llevas ${v.publishedThisWeek} de ${WEEKLY_POSTS_PER_PUBLISHER} posts en los últimos 7 días.`}
        actions={<Link href="/communities" className={btn("ghost", "sm")}>Todas las comunidades</Link>}
      />

      <Card>
        <PanelHeader title="1 · Publicar" subtitle="Grupos donde ya estás dentro, permiten promoción y llevan más de 21 días sin post. Pega el texto en el grupo y vuelve aquí a marcarlo." />
        <div className="px-5 pb-5 pt-3">
          <PublishQueue rows={v.queue} messageKeys={v.messageKeys} remaining={v.remaining} publishedThisWeek={v.publishedThisWeek} quota={WEEKLY_POSTS_PER_PUBLISHER} />
        </div>
      </Card>

      <Card>
        <PanelHeader title="2 · Unirse" subtitle="Grupos aprobados donde todavía no eres miembro. Pide entrar y avisa aquí cuando te acepten." />
        <div className="px-5 pb-5 pt-3">
          {v.toJoin.length === 0 ? (
            <p className={EMPTY}>No hay grupos aprobados por unirte.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {v.toJoin.map(({ community: c, membership }) => (
                <li key={c.id} className="flex flex-col gap-2 rounded-2xl border border-line bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/communities/${c.id}`} className="text-sm font-bold hover:underline">{c.name}</Link>
                    <Badge tone="gray">{COMMUNITY_PLATFORM[c.platform]}</Badge>
                    {c.priority && <Badge tone={c.priority === "A" ? "green" : "gray"}>Prioridad {c.priority}</Badge>}
                  </div>
                  <MembershipButtons communityId={c.id} url={c.url} status={membership} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card>
        <PanelHeader title="3 · Responder" subtitle="Tus posts de los últimos 7 días. Si alguien responde con interés, regístralo aquí." />
        <div className="px-5 pb-5 pt-3">
          {v.toReply.length === 0 ? (
            <p className={EMPTY}>No has publicado posts en los últimos 7 días.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {v.toReply.map((p) => (
                <li key={p.postId}>
                  <PostCard communityName={p.communityName} canDelete={false} post={{ id: p.postId, code: p.code, status: "publicado", finalText: null, postUrl: p.postUrl, publishedAt: p.publishedAt, clicks: p.clicks }} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
