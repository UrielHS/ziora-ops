import { Snapshot } from "@/domain/app-users";
import { hmacSha256Hex } from "@/lib/crypto";
import { requireEnv } from "@/lib/env";

/**
 * Pide el snapshot de usuarios a la Cloud Function `opsSnapshot` de Ziora Copilot.
 * Firma: X-Ops-Signature = HMAC-SHA256(ZIORA_APP_BRIDGE_SECRET, cuerpo). La función rechaza
 * peticiones con más de 5 minutos de antigüedad. Contrato completo: docs/PUENTE-ZIORA-APP.md.
 */
export async function fetchAppSnapshot() {
  const url = requireEnv("ZIORA_APP_SNAPSHOT_URL");
  const body = JSON.stringify({ requestedAt: new Date().toISOString(), v: 2 });
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ops-signature": hmacSha256Hex(requireEnv("ZIORA_APP_BRIDGE_SECRET"), body) },
    body,
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`opsSnapshot respondió ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const parsed = Snapshot.safeParse(await res.json());
  if (!parsed.success) {
    // No se guarda nada: el contrato protege datos de pacientes y no se relaja aquí.
    const issue = parsed.error.issues[0];
    throw new Error(`Snapshot rechazado (${issue.path.join(".")}: ${issue.message}). Revisa la función opsSnapshot.`);
  }
  return parsed.data;
}
