import { NextResponse } from "next/server";
import { db } from "@/db";
import { applySnapshot } from "@/domain/app-users";
import { closeStaleSuggestions, suggestFollowups } from "@/domain/followups";
import { syncLeadStatusFromAppUsers } from "@/domain/leads";
import { fetchAppSnapshot } from "@/integrations/ziora-app";
import { isJobAuthorized } from "@/lib/job-auth";

// Cloud Scheduler cada hora: POST con Authorization: Bearer <JOB_SECRET>
export async function POST(req: Request) {
  if (!isJobAuthorized(req)) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  try {
    const snap = await fetchAppSnapshot();
    const applied = await applySnapshot(db, snap);
    // Los leads que ya entraron a la app avanzan solos (en_trial / pago).
    const leads = await syncLeadStatusFromAppUsers(db);
    // Después de actualizar a los usuarios: cerrar sugerencias resueltas y crear las nuevas.
    const closed = await closeStaleSuggestions(db);
    const { created } = await suggestFollowups(db);
    return NextResponse.json({ ok: true, ...applied, leads, followups: { created, closed } });
  } catch (e) {
    console.error("sync-ziora-users", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
