/**
 * Importa el inventario de comunidades (CSV de docs/gtm/comunidades) a Ops. Una sola corrida; idempotente por URL.
 *
 *   export $(grep -E "^DATABASE_URL" .env | tr -d '\r'); npx tsx dev/import-comunidades.ts <ruta.csv>
 *
 * Todo entra "por revisar" con origen tavily_2026_11. Imprime { created, existing, skipped }.
 */
import { readFileSync } from "node:fs";

async function main() {
  const path = process.argv[2];
  if (!path) { console.error("Uso: npx tsx dev/import-comunidades.ts <ruta.csv>"); process.exit(1); }
  const { db } = await import("@/db");
  const { importCommunities, parseCommunitiesCsv } = await import("@/domain/communities");
  const { rows, skipped } = parseCommunitiesCsv(readFileSync(path, "utf8"));
  const { created, existing } = await importCommunities(db, rows, { origin: "tavily_2026_11" });
  console.log(JSON.stringify({ created, existing, skipped }, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
