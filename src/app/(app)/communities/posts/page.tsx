import Link from "next/link";
import { and, desc, eq, gte } from "drizzle-orm";
import { PostCard } from "@/components/communities";
import { btn, Empty, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { communities, communityPosts } from "@/db/schema";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MyPostsPage() {
  const access = await requirePagePermission("communities.operate");
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  // Mis posts de la semana (publicados) y los que dejé copiados sin marcar.
  const rows = await db
    .select({ p: communityPosts, name: communities.name })
    .from(communityPosts)
    .innerJoin(communities, eq(communities.id, communityPosts.communityId))
    .where(and(eq(communityPosts.publisherId, access.user.id), gte(communityPosts.createdAt, weekAgo)))
    .orderBy(desc(communityPosts.createdAt));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Marketing · Comunidades"
        title="Mis posts"
        subtitle="Los de los últimos 7 días. Cuando alguien responda con interés, regístralo para que quede asignado."
        actions={<Link href="/communities/publicar" className={btn("ghost", "sm")}>Publicar</Link>}
      />
      {rows.length === 0 ? (
        <Empty title="No tienes posts en los últimos 7 días" text="Ve a Publicar para generar el primero." action={<Link href="/communities/publicar" className={btn("primary")}>Ir a publicar</Link>} />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map(({ p, name }) => <PostCard key={p.id} post={p} communityName={name} canDelete />)}
        </div>
      )}
    </div>
  );
}
