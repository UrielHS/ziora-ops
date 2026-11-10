import { and, arrayContains, asc, count, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { contentPieces, demoRequests, goals } from "@/db/schema";

export { GTM_START, gtmDay, gtmPhase } from "@/lib/gtm";

/** Metas con su valor actual. Las "auto" se calculan con datos de Ziora Ops en lugar de captura manual. */
export async function goalsWithValues() {
  const rows = await db.select().from(goals).orderBy(asc(goals.position));
  const [[demos], [paid], [fb]] = await Promise.all([
    db.select({ n: count() }).from(demoRequests).where(inArray(demoRequests.stage, ["scheduled", "done", "trial", "paid", "no_show"])),
    db.select({ n: count() }).from(demoRequests).where(eq(demoRequests.stage, "paid")),
    db.select({ n: count() }).from(contentPieces).where(and(arrayContains(contentPieces.channels, ["facebook_group"]), eq(contentPieces.status, "published"))),
  ]);
  const auto: Record<string, number> = { demos: demos.n, paid: paid.n, fb_posts: fb.n };
  return rows.map((g) => ({ ...g, value: g.auto ? (auto[g.auto] ?? g.current) : g.current }));
}
