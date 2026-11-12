/**
 * Importa las listas de redes (docs/gtm/redes) a Ops con Ale como dueña. Idempotente por (plataforma, usuario).
 *
 *   export $(grep -E "^DATABASE_URL" .env | tr -d '\r'); npx tsx dev/import-leads-redes.ts --lista=influencers|psicologos --owner=<correo> <ruta.csv>
 *
 * Imprime { created, existing, otherOwner, skipped } (ids y conteos; nunca usuarios ni correos).
 */
import { readFileSync } from "node:fs";

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const list = flag("lista");
  const owner = flag("owner");
  const path = args.find((a) => !a.startsWith("--"));
  if ((list !== "influencers" && list !== "psicologos") || !owner || !path) {
    console.error("Uso: npx tsx dev/import-leads-redes.ts --lista=influencers|psicologos --owner=<correo> <ruta.csv>");
    process.exit(1);
  }
  const { db } = await import("@/db");
  const { importSocialLeads, parseSocialCsv } = await import("@/domain/social-leads");
  const { resolveOwnerIds } = await import("./seed-comunidades");
  const [ownerId] = await resolveOwnerIds(db, [owner]);
  const { rows, skipped } = parseSocialCsv(readFileSync(path, "utf8"), list);
  const res = await importSocialLeads(db, rows, { ownerId, actor: { userId: ownerId, label: "Importación de redes" } });
  console.log(JSON.stringify({ ...res, skipped }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
