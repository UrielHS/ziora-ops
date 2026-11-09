// Lista los contactos cuyo teléfono normalizó igual que el de otro contacto más antiguo (la migración 0012 les quitó
// phone_e164 y les dejó details.telefono_duplicado_de). Solo lectura: la fusión se hace a mano en Ziora Ops.
// Uso: DATABASE_URL=... npx tsx dev/duplicados-telefono.ts
import postgres from "postgres";

const s = postgres(process.env.DATABASE_URL!);
async function main() {
  const rows = await s`
    select d.id, d.name, d.email, d.phone, k.id as keeper_id, k.name as keeper_name, k.email as keeper_email, k.phone_e164 as keeper_phone
    from ops.contacts d
    join ops.contacts k on k.id = (d.details->>'telefono_duplicado_de')::uuid
    order by k.name, d.created_at`;
  console.log(`duplicados: ${rows.length}`);
  if (rows.length) console.table(rows);
  await s.end();
}
main().catch((e) => { console.error(e.message); process.exit(1); });
