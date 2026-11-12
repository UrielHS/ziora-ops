import { NextResponse } from "next/server";
import { db } from "@/db";
import { CODE_RE, resolvePostLink } from "@/domain/community-posts";
import { resolveSocialLink } from "@/domain/social-links";
import { isSecretAuthorized } from "@/lib/job-auth";

/**
 * La landing (/c/<código>) pregunta aquí a qué comunidad y campaña pertenece una liga corta.
 * Authorization: Bearer <COMMUNITY_LINK_SECRET>. Cuerpo: { code, count? } — count=true suma un clic.
 * No se loggea el código ni nada del visitante.
 */
export async function POST(req: Request) {
  if (!isSecretAuthorized(req, "COMMUNITY_LINK_SECRET")) return NextResponse.json({ error: "no autorizado" }, { status: 401 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "cuerpo no válido" }, { status: 400 }); }
  const { code, count } = (body ?? {}) as { code?: unknown; count?: unknown };
  if (typeof code !== "string" || !CODE_RE.test(code)) return NextResponse.json({ ok: false, error: "código no válido" }, { status: 400 });
  const opts = { count: count === true };
  const found = (await resolvePostLink(db, code, opts)) ?? (await resolveSocialLink(db, code, opts));
  if (!found) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: true, utm: found.utm });
}
