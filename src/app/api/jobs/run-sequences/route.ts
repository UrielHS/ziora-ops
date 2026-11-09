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
  const result = await runSequences(db, { now, limit: EMAIL_LIMIT_PER_RUN });
  return NextResponse.json({ ok: true, ...result });
}
