import { BaseMessageRow } from "@/components/communities";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { baseMessages } from "@/db/schema";
import { can } from "@/lib/permissions";
import { requirePagePermission } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const access = await requirePagePermission("communities.operate");
  const canApprove = can(access, "communities.approve_messages");
  const rows = await db.select().from(baseMessages).orderBy(baseMessages.key);
  const communityRows = rows.filter((m) => !/^R[PI]\d$/.test(m.key));
  const socialRows = rows.filter((m) => /^R[PI]\d$/.test(m.key));
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        eyebrow="Marketing · Comunidades"
        title="Mensajes base"
        subtitle={canApprove ? "M0 pide permiso al admin; M1–M6 son los posts. Solo los aprobados se pueden usar." : "M0 pide permiso al admin; M1–M6 son los posts. Solo dirección aprueba o retira mensajes."}
      />
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-bold">Comunidades (M0–M6)</h2>
        {communityRows.map((m) => <BaseMessageRow key={m.key} m={m} canApprove={canApprove} />)}
      </section>
      {socialRows.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-bold">Redes: DM por tipo y paso</h2>
          {socialRows.map((m) => <BaseMessageRow key={m.key} m={m} canApprove={canApprove} />)}
        </section>
      )}
    </div>
  );
}
