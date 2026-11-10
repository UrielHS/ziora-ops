import { NextResponse } from "next/server";
import { db } from "@/db";
import { EMAIL_LIMIT_PER_RUN, inSendingWindow, runSequences } from "@/domain/sequences";
import { isJobAuthorized } from "@/lib/job-auth";

export const maxDuration = 300;

/**
 * Cadencia de leads: Cloud Scheduler lo llama cada hora de 8 a 20 (CDMX). Fuera de esa ventana no toca la base.
 * Solo actúa sobre enrollments existentes: si nadie enroló a nadie, no manda nada.
 */
export async function POST(req: Request) {
  if (!isJobAuthorized(req)) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  const now = new Date();
  if (!inSendingWindow(now)) return NextResponse.json({ ok: true, skippedWindow: true });
  // ?limit=N: corrida acotada para probar a mano (p. ej. 1 correo); nunca por encima del tope normal.
  const asked = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, EMAIL_LIMIT_PER_RUN) : EMAIL_LIMIT_PER_RUN;
  const result = await runSequences(db, { now, limit });
  return NextResponse.json({ ok: true, ...result });
}
