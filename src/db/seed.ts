/**
 * Datos de ejemplo para ver Ziora Ops funcionando en local.
 * Basados en el brief GTM del 9-oct-2026. Contactos y psicólogos son FICTICIOS (correos @example.com).
 *
 *   npm run db:seed          (idempotente: no hace nada si ya hay datos)
 *
 * Nunca corre contra producción: se niega si detecta Cloud SQL o NODE_ENV=production.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as ops from "./schema";
import * as shared from "./shared";

if (process.env.NODE_ENV === "production" || process.env.DB_SOCKET_PATH) {
  console.error("Seed bloqueado: solo para desarrollo local.");
  process.exit(1);
}
const client = postgres(process.env.DATABASE_URL!, { max: 1 });
const db = drizzle(client, { schema: { ...ops, ...shared } });

const DAY = 86_400_000;
const now = Date.now();
const daysAgo = (n: number, h = 10) => {
  const d = new Date(now - n * DAY);
  d.setUTCHours(h + 6, 0, 0, 0);
  return n >= 0 && d.getTime() > now ? new Date(now - (n * DAY + 3_600_000 * (1 + (h % 5)))) : d; // nunca en el futuro
};
const dateISO = (offset: number) => new Date(now + offset * DAY).toISOString().slice(0, 10);
const pick = <T,>(arr: T[], i: number) => arr[i % arr.length];

async function main() {
  // ---------- equipo (public.users: en producción lo administra Event Ops) ----------
  const team = [
    { email: "chris@ziora.dev", name: "Chris", role: "admin" as const },
    { email: "rafa@ziora.dev", name: "Rafa", role: "operator" as const },
    { email: "ale@ziora.dev", name: "Ale", role: "operator" as const },
    { email: (process.env.DEV_LOGIN_EMAIL ?? "uriel@ziora.dev").toLowerCase(), name: "Uriel", role: "admin" as const },
    { email: "paulina@ziora.dev", name: "Paulina", role: "operator" as const },
    { email: "euridice@ziora.dev", name: "Euridice", role: "operator" as const },
    { email: "j@ziora.dev", name: "J", role: "operator" as const },
  ];
  await db.insert(shared.users).values(team.map((u) => ({ ...u, active: true }))).onConflictDoNothing();
  const users = await db.select().from(shared.users);
  const U = (name: string) => users.find((u) => u.name === name)!.id;

  // Roles de Ziora Ops (idempotente: se siembra aunque ya haya datos).
  const roles: [string, (typeof ops.opsRoleEnum.enumValues)[number]][] = [
    ["Chris", "ceo"], ["Rafa", "clinical_director"], ["Ale", "marketing"], ["Euridice", "sales"],
    ["Paulina", "operations"], ["Uriel", "dev_qa"], ["Uriel", "operations"],
  ];
  await db.insert(ops.memberRoles).values(roles.map(([name, role]) => ({ userId: U(name), role }))).onConflictDoNothing();

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(ops.tasks);
  if (n > 0) {
    console.log("Ya hay datos en ops.tasks; solo se sembraron equipo y roles.");
    return;
  }

  // ---------- épicas y sprints ----------
  const epicRows = await db.insert(ops.epics).values([
    { key: "GTM", name: "Go-to-market y redes", color: "#059669" },
    { key: "PROD", name: "Producto e ingeniería", color: "#1D5FA8" },
    { key: "QA", name: "QA", color: "#B42318" },
    { key: "VENTAS", name: "Ventas y demos", color: "#A15C07" },
    { key: "LEGAL", name: "Legal y cumplimiento", color: "#6B4FA8" },
  ]).returning();
  const E = (k: string) => epicRows.find((e) => e.key === k)!.id;

  const [s1, s2] = await db.insert(ops.sprints).values([
    { name: "Semanas 1–2 · Montaje", goal: "Perfiles, banco de 30 piezas y permisos de testimonios", startsOn: "2026-10-12", endsOn: "2026-10-25", status: "active" },
    { name: "Semanas 3–4 · Educación y memes", goal: "Cadencia completa 60/25/15", startsOn: "2026-10-26", endsOn: "2026-11-08", status: "planned" },
    { name: "Semanas 5–6 · Educación y memes", startsOn: "2026-11-09", endsOn: "2026-11-22", status: "planned" },
  ]).returning();

  type T = Partial<typeof ops.tasks.$inferInsert> & { title: string };
  const t = (x: T): typeof ops.tasks.$inferInsert => ({ status: "todo", priority: "medium", sprintId: s1.id, reporterId: U("Chris"), ...x });
  await db.insert(ops.tasks).values([
    t({ title: "Hotfix de Stripe: los checkouts de producción fallan desde el 29-sep", description: "Sin campañas de pago ni de upgrade hasta confirmarlo.", epicId: E("PROD"), assigneeId: U("Chris"), priority: "urgent", status: "in_progress", blocker: true, dueOn: dateISO(1) }),
    t({ title: "Landing dice '5 sesiones gratis'; el código da 10", description: "Corregir en landing y en ONBOARDING_PRODUCTO.md antes de publicar precios.", epicId: E("PROD"), assigneeId: U("Chris"), priority: "urgent", status: "in_review", blocker: true, dueOn: dateISO(2) }),
    t({ title: "Perfiles de IG, TikTok y Facebook con bio y enlace", epicId: E("GTM"), assigneeId: U("Ale"), status: "done", dueOn: dateISO(-4) }),
    t({ title: "Banco de 30 piezas para IG y TikTok", epicId: E("GTM"), assigneeId: U("Paulina"), priority: "high", status: "in_progress", dueOn: dateISO(3) }),
    t({ title: "Guía visual de redes (paleta, tipografía, plantillas)", epicId: E("GTM"), assigneeId: U("Ale"), status: "in_review", dueOn: dateISO(2) }),
    t({ title: "Lista de 10 a 15 grupos de Facebook de psicólogos", epicId: E("GTM"), assigneeId: U("Uriel"), status: "in_progress", dueOn: dateISO(4) }),
    t({ title: "Pasar las primeras 10 piezas por la checklist legal", epicId: E("LEGAL"), assigneeId: U("Paulina"), dueOn: dateISO(5) }),
    t({ title: "Pedir testimonio con nombre a Rafa y a Juan Manuel", epicId: E("GTM"), assigneeId: U("Chris"), priority: "high", dueOn: dateISO(5) }),
    t({ title: "Revisar el testimonio de Cardiel ('más apoyados entre sesiones')", epicId: E("LEGAL"), assigneeId: U("Chris"), dueOn: dateISO(3) }),
    t({ title: "Confirmar por escrito el despliegue del alta sin fricción", epicId: E("PROD"), assigneeId: U("Chris"), priority: "high", dueOn: dateISO(1) }),
    t({ title: "Capturas y clips con la sesión de ejemplo ficticia", epicId: E("GTM"), assigneeId: U("Ale"), dueOn: dateISO(6), labels: ["video"] }),
    t({ title: "Cargar la disponibilidad de Rafa para demos", epicId: E("VENTAS"), assigneeId: U("Rafa"), status: "done", dueOn: dateISO(-5) }),
    t({ title: "UTM en todos los enlaces y que PostHog los conserve hasta signup_completed", epicId: E("PROD"), assigneeId: U("J"), status: "in_progress", dueOn: dateISO(6) }),
    t({ title: "Tablero semanal de métricas para la revisión del lunes", epicId: E("GTM"), assigneeId: U("J"), status: "done" }),
    t({ title: "Quitar 'recordatorios automáticos por WhatsApp' del hero del sitio", description: "El brief dice solo botones wa.me; la landing lo promete.", epicId: E("LEGAL"), assigneeId: U("Uriel"), priority: "high", dueOn: dateISO(2) }),
    t({ title: "Revisar políticas de anuncios de Meta (segmentación por salud)", epicId: E("GTM"), assigneeId: U("Ale"), dueOn: dateISO(5) }),
    t({ title: "Preparar puntos para la reunión legal del 30-oct", epicId: E("LEGAL"), assigneeId: U("Chris"), status: "todo", dueOn: "2026-10-28", sprintId: s2.id }),
    t({ title: "Video demo corto para todos los canales", epicId: E("GTM"), assigneeId: U("Ale"), priority: "high", sprintId: s2.id, dueOn: "2026-11-06", labels: ["video"] }),
    t({ title: "Primeras 2 piezas con pauta (solo si Stripe está confirmado)", epicId: E("GTM"), assigneeId: U("Ale"), sprintId: s2.id }),
    t({ title: "Página de seguridad propia", epicId: E("PROD"), sprintId: null, status: "backlog" }),
    t({ title: "Calculadora de ROI con supuestos editables", epicId: E("PROD"), sprintId: null, status: "backlog", assigneeId: U("J") }),
    t({ title: "Biblioteca pública de plantillas (SOAP, DAP, entrevista inicial)", epicId: E("GTM"), sprintId: null, status: "backlog", assigneeId: U("Rafa") }),
    t({ title: "QA de referidos antes de publicar la oferta", epicId: E("QA"), assigneeId: U("Rafa"), status: "in_progress", dueOn: dateISO(4) }),
    t({ title: "QA de compartir pantalla en iPad", epicId: E("QA"), assigneeId: U("Rafa"), dueOn: dateISO(6) }),
  ]);

  // ---------- contactos ficticios (propios de Ziora Ops) ----------
  const first = ["Andrea", "Mariana", "Daniela", "Fernanda", "Sofía", "Valeria", "Lucía", "Carolina", "Paola", "Ximena", "Diego", "Javier", "Luis", "Rodrigo", "Emilio", "Santiago", "Adriana", "Gabriela", "Renata", "Montserrat", "Alejandro", "Héctor", "Itzel", "Brenda"];
  const last = ["Ruiz", "Hernández", "García", "Martínez", "López", "Gómez", "Torres", "Ramírez", "Flores", "Vargas", "Castillo", "Mendoza", "Ortiz", "Navarro", "Salinas", "Aguilar", "Cervantes", "Ibarra", "Treviño", "Zavala"];
  const cities = ["cdmx", "cdmx", "cdmx", "gdl", "mty", "gdl", "mty", "cdmx"] as const;
  const sources = ["demo_form", "instagram", "facebook_group", "event_ops", "manual", "demo_form", "linkedin", "facebook_group"] as const;
  const people = Array.from({ length: 46 }, (_, i) => {
    const f = pick(first, i * 7), l = pick(last, i * 3 + 1), l2 = pick(last, i * 5 + 4);
    const title = i % 3 === 0 ? "Dra." : "Psic.";
    return {
      name: `${title} ${f} ${l} ${l2}`, email: `${f}.${l}${i}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") + "@example.com",
      phone: `+52 ${i % 3 === 0 ? "33" : i % 3 === 1 ? "55" : "81"} ${String(1000 + i * 37).slice(0, 4)} ${String(2000 + i * 91).slice(0, 4)}`,
      city: pick([...cities], i), source: pick([...sources], i),
      updatedAt: daysAgo(i % 20), createdAt: daysAgo(10 + (i % 30)),
    };
  });
  const inserted = await db.insert(ops.contacts).values(people).returning({ id: ops.contacts.id, source: ops.contacts.source, name: ops.contacts.name, email: ops.contacts.email, phone: ops.contacts.phone, city: ops.contacts.city });
  const tagRows: (typeof ops.contactTags.$inferInsert)[] = [];
  inserted.forEach((c, i) => {
    tagRows.push({ contactId: c.id, tag: "psychologist" });
    if (["demo_form", "instagram", "facebook_group"].includes(c.source)) tagRows.push({ contactId: c.id, tag: "lead" });
    if (c.source === "event_ops") tagRows.push({ contactId: c.id, tag: "attendee" });
    if (i % 9 === 0) tagRows.push({ contactId: c.id, tag: "ziora_user" });
    if (i % 13 === 0) tagRows.push({ contactId: c.id, tag: "clinic" });
  });
  await db.insert(ops.contactTags).values(tagRows).onConflictDoNothing();

  // Contactos de Event Ops (public.contacts): asistentes a eventos y aliados. Solo se ven en "Importar de Event Ops".
  const eoPeople = [
    ...people.slice(0, 30).map((p) => ({ name: p.name, email: p.email, phone: p.phone, city: p.city, source: "luma" as const, type: "person" as const })),
    { name: "Juan Manuel Sánchez", email: "jm.sanchez@example.com", city: "cdmx" as const, source: "manual" as const, type: "person" as const },
    { name: "Laura Benítez (Health2Tech)", email: "laura.h2t@example.com", city: "cdmx" as const, source: "ai_tinkerers" as const, type: "person" as const },
    { name: "Coworking Roma Norte", email: "eventos.roma@example.com", city: "cdmx" as const, source: "manual" as const, type: "person" as const },
  ];
  const eo = await db.insert(shared.eoContacts).values(eoPeople).returning({ id: shared.eoContacts.id });
  await db.insert(shared.eoContactTags).values([
    ...eo.slice(0, 30).map((c) => ({ contactId: c.id, tag: "attendee" as const })),
    { contactId: eo[30].id, tag: "university" as const }, { contactId: eo[31].id, tag: "community_partner" as const }, { contactId: eo[32].id, tag: "venue" as const },
  ]).onConflictDoNothing();
  // Los primeros 10 ya se importaron a Ziora Ops (quedan ligados por event_ops_contact_id).
  for (let i = 0; i < 10; i++) {
    await db.update(ops.contacts).set({ eventOpsContactId: eo[i].id }).where(sql`${ops.contacts.id} = ${inserted[i].id}`);
  }

  await db.insert(ops.contactConsents).values(
    inserted.filter((_, i) => i % 5 !== 1 && i % 7 !== 3).map((c, i) => ({
      contactId: c.id, channel: "email", optIn: i !== 4, source: c.source === "event_ops" ? "evento" : c.source,
      evidence: c.source === "event_ops" ? "Casilla de registro en Luma (Ugly Talk)" : c.source === "demo_form" ? "Casilla en ziora-copilot.com/demo" : "Mensaje directo aceptando noticias",
      optedInAt: daysAgo(12), optedOutAt: i === 4 ? daysAgo(3) : null,
    })),
  );

  // ---------- demos ----------
  const stagesPlan: [typeof ops.demoStageEnum.enumValues[number], number, number | null][] = [
    ["requested", 0, null], ["requested", 1, null], ["requested", 2, null], ["requested", 4, null],
    ["scheduled", 1, 1], ["scheduled", 2, 2], ["scheduled", 3, 3], ["scheduled", 5, 4],
    ["done", 6, -2], ["done", 8, -3],
    ["trial", 9, -6], ["trial", 12, -9], ["trial", 7, -3],
    ["paid", 16, -15], ["no_show", 10, -4], ["lost", 13, -8], ["requested", 3, null], ["scheduled", 4, 5],
  ];
  const pains = ["Escribir notas en la noche", "Tener el expediente en orden (NOM-004)", "Aplicar escalas sin perder tiempo", "Llevar el seguimiento de tareas del paciente", "Las notas se me acumulan", "Pasar de Word y papel a algo ordenado"];
  const demoInputs = stagesPlan.map(([stage, created, sched], i) => {
    const c = inserted[i * 2 + 1];
    return {
      contactId: c.id, fullName: c.name, email: c.email!, whatsapp: c.phone, stage,
      patientsPerWeek: pick(["10-20", "21-30", "1-9", "10-20", "30+"], i), teletherapy: i % 4 === 3 ? "No" : "Sí",
      painPoint: pick(pains, i), createdAt: daysAgo(created, 9 + (i % 8)),
      scheduledAt: sched === null ? null : (() => { const d = new Date(now + sched * DAY); d.setUTCHours(16 + (i % 6), i % 2 ? 30 : 0, 0, 0); return d; })(),
      trialStartedAt: stage === "trial" || stage === "paid" ? daysAgo(-(sched ?? 0) - 1) : null,
      ownerId: i % 3 === 0 ? U("Rafa") : i % 3 === 1 ? U("Uriel") : U("Chris"),
      lostReason: stage === "lost" ? "Ya usa otra herramienta" : null,
      notes: stage === "done" ? "Le interesó el PDF NOM-004 y las escalas. Pidió precio anual." : null,
      utm: (i % 3 === 0 ? { utm_source: "instagram", utm_medium: "organic", utm_campaign: "pilar_roi" } : i % 4 === 1 ? { utm_source: "instagram", utm_medium: "paid", utm_campaign: "demo-psicologos-gdl" } : {}) as Record<string, string>,
      source: i % 5 === 4 ? "manual" : "ziora-copilot.com/demo",
    };
  });
  await db.insert(ops.demoRequests).values(demoInputs);

  // ---------- bugs ----------
  await db.insert(ops.bugs).values([
    { title: "Checkout de Stripe falla al confirmar el pago en producción", severity: "critical", status: "in_progress", area: "Checkout / Stripe", source: "manual", assigneeId: U("Chris"), reporterEmail: "rafa@ziora.dev", stepsToReproduce: "1. Planes\n2. Elegir Pro mensual\n3. Pagar con tarjeta de prueba", expected: "Suscripción activa", actual: "Error 500 tras confirmar", prUrl: "https://github.com/ziora/ziora-app/pull/218", createdAt: daysAgo(20) },
    { title: "Compartir pantalla no inicia en iPad (Safari 18)", severity: "high", status: "triaged", area: "Compartir pantalla", device: "iPad Air · Safari 18", source: "manual", assigneeId: U("Rafa"), createdAt: daysAgo(6) },
    { title: "El enlace de referido no aplica el beneficio al registrarse", severity: "medium", status: "new", area: "Referidos", source: "ziora_app", reporterEmail: "psic.cliente@example.com", appVersion: "1.14.2", createdAt: daysAgo(2) },
    { title: "La landing muestra '5 sesiones gratis' en la tabla de planes", severity: "medium", status: "in_progress", area: "Landing", source: "manual", assigneeId: U("Chris"), prUrl: "https://github.com/ziora/landing/pull/221", createdAt: daysAgo(9) },
    { title: "Texto cortado en el resumen del portal del paciente (móvil)", severity: "low", status: "new", area: "Portal del paciente", device: "iPhone 13 · Chrome", source: "ziora_app", createdAt: daysAgo(1) },
    { title: "Error intermitente al subir audio de más de 90 min", severity: "high", status: "new", area: "Grabación", source: "sentry", externalId: "ZIORA-APP-3F2", occurrences: 7, createdAt: daysAgo(3) },
    { title: "PDF NOM-004 sin logo cuando el logo es PNG transparente", severity: "medium", status: "verified", area: "Nota clínica", source: "manual", createdAt: daysAgo(15) },
  ]);

  // ---------- PRs (caché; en producción llegan por webhook) ----------
  const pr = (repo: string, number: number, title: string, author: string, state: "open" | "merged" | "closed", review: string | null, checks: string | null, ago: number, draft = false) => ({
    repo, number, title, author, state, reviewState: review, checksState: checks, draft, url: `https://github.com/${repo}/pull/${number}`,
    headRef: title.split(":")[0].replace(/[()]/g, "/") + number, baseRef: "main", openedAt: daysAgo(ago + 2), ghUpdatedAt: daysAgo(ago, 15), mergedAt: state === "merged" ? daysAgo(ago) : null,
  });
  await db.insert(ops.pullRequests).values([
    pr("ziora/ziora-app", 218, "fix(stripe): webhook idempotente y reintento de checkout", "chrislfmd", "open", "approved", "success", 0),
    pr("ziora/landing", 221, "fix(landing): 10 sesiones en el plan gratis", "chrislfmd", "open", "pending", "success", 1),
    pr("ziora/ziora-app", 223, "feat(onboarding): alta sin fricción con 14 días de Pro", "chrislfmd", "open", "changes_requested", "failure", 1),
    pr("ziora/ziora-app", 224, "chore(analytics): conservar UTM hasta signup_completed", "j-dev", "open", null, "pending", 0, true),
    pr("ziora/ziora-app", 215, "fix(pdf): logo PNG transparente en NOM-004", "chrislfmd", "merged", "approved", "success", 4),
    pr("ziora/landing", 219, "feat(demo): reserva de 25 min desde la landing", "chrislfmd", "merged", "approved", "success", 11),
  ]);

  // ---------- eventos (public.events; en producción los crea Event Ops) ----------
  const evs = await db.execute<{ id: string; name: string }>(sql`
    insert into public.events (name, format, city, date, status, fx_rate_mxn_per_usd, created_by, registration_url, platform)
    values
      ('Demo Night · Ziora Founders', 'demo_night', 'cdmx', ${dateISO(7)}, 'confirmed', 18.5, ${U("Chris")}, 'https://lu.ma/ziora-demo-night', 'independent'),
      ('Ugly Talk · IA y salud mental', 'panel', 'cdmx', ${dateISO(-10)}, 'done', 18.5, ${U("Chris")}, 'https://lu.ma/ugly-talk', 'ugly_talks'),
      ('Taller: SOAP, DAP y BIRP con IA', 'workshop', 'gdl', ${dateISO(21)}, 'planning', 18.5, ${U("Chris")}, null, 'independent'),
      ('Health2Tech Mixer', 'mixer', 'mty', ${dateISO(35)}, 'idea', 18.5, ${U("Chris")}, null, 'health2tech')
    returning id, name`);
  const evRows = [...evs];
  const demoNight = evRows.find((e) => e.name.startsWith("Demo Night"))!;
  const ugly = evRows.find((e) => e.name.startsWith("Ugly"))!;
  await db.insert(shared.eventContacts).values(
    eo.slice(0, 30).map((c, i) => ({ eventId: i % 2 ? demoNight.id : ugly.id, contactId: c.id, roleInEvent: "guest" as const, confirmed: i % 3 === 0 })),
  ).onConflictDoNothing();

  // ---------- plantillas y campañas ----------
  const invite = TEMPLATE_INVITE;
  const [tInvite, , tNews] = await db.insert(ops.emailTemplates).values([
    { name: "Invitación a evento", subject: "{{nombre}}, te invitamos a {{evento}}", previewText: "Una noche para psicólogos que quieren recuperar horas", html: invite, createdBy: U("Paulina") },
    { name: "Bienvenida al trial", subject: "Tu primer borrador de nota en minutos, {{nombre}}", previewText: "3 pasos para empezar con Ziora", html: TEMPLATE_WELCOME, createdBy: U("Paulina") },
    { name: "Novedades del mes", subject: "Lo nuevo en Ziora · octubre", html: TEMPLATE_NEWS, createdBy: U("Paulina") },
  ]).returning();
  const [sentCamp] = await db.insert(ops.campaigns).values([
    { name: "Invitación Ugly Talk · CDMX", templateId: tInvite.id, eventId: ugly.id, segment: { tags: ["psychologist"], cities: ["cdmx"], eventId: ugly.id }, status: "sent", sentAt: daysAgo(14), createdBy: U("Paulina"), createdAt: daysAgo(15) },
    { name: "Demo Night · psicólogos CDMX", templateId: tInvite.id, eventId: demoNight.id, subject: "Te invitamos a Demo Night · CDMX", segment: { tags: ["psychologist"], cities: ["cdmx"] }, status: "draft", createdBy: U("Paulina") },
    { name: "Novedades de octubre", templateId: tNews.id, segment: { tags: ["psychologist", "ziora_user"] }, status: "draft", createdBy: U("Paulina"), createdAt: daysAgo(1) },
  ]).returning();
  const statuses = ["delivered", "opened", "opened", "clicked", "delivered", "opened", "bounced", "delivered", "clicked", "opened", "delivered", "opened"] as const;
  await db.insert(ops.campaignSends).values(
    inserted.filter((c) => c.city === "cdmx").slice(0, 12).map((c, i) => ({
      campaignId: sentCamp.id, contactId: c.id, email: c.email!, status: statuses[i % statuses.length], providerMessageId: `seed_${i}`,
    })),
  );

  // ---------- calendario de contenido ----------
  type P = typeof ops.contentPieces.$inferInsert;
  const piece = (x: Partial<P> & Pick<P, "title" | "pillar" | "channel" | "format">): P => ({ status: "idea", risk: "low", channels: [x.channel], ...x });
  const published = { status: "published" as const, legalChecklistOk: true };
  await db.insert(ops.contentPieces).values([
    piece({ title: "1 de cada 3 psicólogos se siente agotado (APA 2024–2025, EE. UU.)", pillar: "estudios", channel: "instagram", format: "carrusel", publishOn: dateISO(-6), ...published, ownerId: U("Paulina"), sources: ["APA Practitioner Pulse 2024 y 2025 (EE. UU.)"] }),
    piece({ title: "Terminé mi último paciente. Mi agenda: te faltan 7 notas", pillar: "memes", channel: "instagram", format: "imagen", publishOn: dateISO(-5), ...published, ownerId: U("Ale") }),
    piece({ title: "De la grabación al borrador SOAP en 4 pasos", pillar: "producto", channel: "instagram", format: "reel", publishOn: dateISO(-4), ...published, ownerId: U("Ale") }),
    piece({ title: "Domingo en la noche: ¿relajarme o armar el expediente?", pillar: "memes", channel: "tiktok", format: "video", publishOn: dateISO(-4), ...published, ownerId: U("Ale") }),
    piece({ title: "Qué dice y qué no dice la evidencia sobre escribas con IA", pillar: "ia_psicoterapia", channel: "facebook_group", format: "aporte", publishOn: dateISO(-3), ...published, ownerId: U("Uriel"), sources: ["NEJM AI, ensayo aleatorizado nov-2025"] }),
    piece({ title: "SOAP, DAP o BIRP: cuál usar", pillar: "psicoterapia_moderna", channel: "instagram", format: "carrusel", publishOn: dateISO(-2), ...published, ownerId: U("Paulina") }),
    piece({ title: "La IA en notas ahorra tiempo, pero poco: 9.5% en un ensayo aleatorizado", pillar: "estudios", channel: "tiktok", format: "video", publishOn: dateISO(-1), ...published, ownerId: U("Ale"), sources: ["NEJM AI 2025 (EE. UU.)"] }),
    piece({ title: "Checklist de consentimiento para grabar con IA", pillar: "ia_psicoterapia", channel: "instagram", format: "carrusel", publishOn: dateISO(0), status: "scheduled", risk: "medium", legalChecklistOk: true, ownerId: U("Paulina") }),
    piece({ title: "Tipos de terapeuta según cuándo cierra sus notas", pillar: "memes", channel: "instagram", format: "reel", publishOn: dateISO(1), status: "approved", legalChecklistOk: true, ownerId: U("Ale") }),
    piece({ title: "¿Cuántas horas te quitan las notas al mes?", pillar: "roi", channel: "instagram", format: "reel", publishOn: dateISO(2), status: "legal_review", risk: "medium", ownerId: U("Paulina") }),
    piece({ title: "Telepsicología: resultados similares a la presencial", pillar: "psicoterapia_moderna", channel: "facebook_group", format: "aporte", publishOn: dateISO(2), status: "draft", ownerId: U("Uriel") }),
    piece({ title: "Lo que la IA NO hace en Ziora", pillar: "producto", channel: "tiktok", format: "video", publishOn: dateISO(3), status: "draft", ownerId: U("Ale") }),
    piece({ title: "SOAP, DAP, BIRP: las letras que nadie pidió en la universidad", pillar: "memes", channel: "tiktok", format: "video", publishOn: dateISO(4), status: "draft", ownerId: U("Ale") }),
    piece({ title: "Los psicólogos que usan IA se duplicaron en un año: 11% a 29%", pillar: "estudios", channel: "instagram", format: "carrusel", publishOn: dateISO(5), status: "draft", ownerId: U("Paulina"), sources: ["APA Practitioner Pulse (EE. UU.)"] }),
    piece({ title: "Punto de equilibrio: Esencial o Pro según tus sesiones", pillar: "roi", channel: "instagram", format: "carrusel", publishOn: dateISO(6), status: "idea", risk: "medium" }),
    piece({ title: "3 preguntas que tu paciente te hará si grabas", pillar: "ia_psicoterapia", channel: "tiktok", format: "video", publishOn: dateISO(8), status: "idea" }),
    piece({ title: "Medir progreso con PHQ-9 y GAD-7 sin perder la conversación", pillar: "psicoterapia_moderna", channel: "instagram", format: "carrusel", publishOn: dateISO(9), status: "idea", risk: "medium" }),
    piece({ title: "Mi relación con el expediente: es complicada", pillar: "memes", channel: "instagram", format: "imagen", publishOn: dateISO(10), status: "idea" }),
    piece({ title: "Cuando te dicen que la IA te va a reemplazar y tienes 14 notas pendientes", pillar: "memes", channel: "tiktok", format: "video", status: "idea", risk: "medium" }),
    piece({ title: "Mi agenda de la semana: 20 pacientes, 20 notas, cero tiempo", pillar: "memes", channel: "instagram", format: "imagen", status: "idea" }),
    piece({ title: "Captura del PDF NOM-004 con logo propio", pillar: "producto", channel: "instagram", format: "imagen", status: "idea", risk: "medium" }),
    piece({ title: "Cosas que nadie te dijo en la carrera: el papeleo también es parte del trabajo", pillar: "memes", channel: "instagram", format: "carrusel", status: "idea" }),
  ]);

  // ---------- metas (sección 9.1 del brief) ----------
  // ---------- ventas B2B ----------
  const [serena, unam, mente] = await db.insert(ops.accounts).values([
    { name: "Clínica Serena (ficticia)", type: "clinic", city: "Guadalajara", therapistsCount: 8, ownerId: U("Euridice") },
    { name: "Facultad de Psicología (ficticia)", type: "university", city: "CDMX", therapistsCount: 40, ownerId: U("Euridice") },
    { name: "Centro Mente Clara (ficticio)", type: "clinic", city: "Monterrey", therapistsCount: 5, ownerId: U("Euridice") },
  ]).returning();
  await db.insert(ops.deals).values([
    { accountId: serena.id, name: "8 licencias Pro", stage: "negotiation", seats: 8, amountMxn: 7200, billingPeriod: "monthly", expectedCloseOn: dateISO(10), ownerId: U("Euridice") },
    { accountId: unam.id, name: "Piloto con supervisores", stage: "proposal", seats: 15, amountMxn: 120000, billingPeriod: "annual", expectedCloseOn: dateISO(30), ownerId: U("Euridice"), stageChangedAt: daysAgo(20) },
    { accountId: mente.id, name: "5 licencias", stage: "won", seats: 5, amountMxn: 4500, billingPeriod: "monthly", ownerId: U("Euridice") },
  ]);
  await db.insert(ops.contracts).values([
    { accountId: mente.id, title: "Licencias Ziora 2026", seats: 5, pricePerSeatMxn: 900, amountMxn: 4500, billingPeriod: "monthly", startsOn: dateISO(-300), endsOn: dateISO(25), status: "active", signedOn: dateISO(-300) },
  ]);

  // ---------- precios de planes (MRR estimado) ----------
  await db.insert(ops.planPrices).values([
    { plan: "free", label: "Gratis", priceMxn: 0, paying: false },
    { plan: "pro", label: "Pro", priceMxn: 590 },
    { plan: "pro_anual", label: "Pro anual", priceMxn: 5900, billingPeriod: "annual" },
    { plan: "clinic", label: "Clínica", priceMxn: 2900 },
  ]).onConflictDoNothing();

  // ---------- redes y anuncios (cifras ficticias, 60 días) ----------
  const nets = await db.insert(ops.socialAccounts).values([
    { platform: "instagram", handle: "@ziora.mx", lastSyncAt: new Date() },
    { platform: "facebook", handle: "Ziora", lastSyncAt: new Date() },
    { platform: "tiktok", handle: "@ziora.mx", lastSyncAt: new Date() },
    { platform: "linkedin", handle: "Ziora Copilot", lastSyncAt: new Date() },
  ]).returning();
  const base = { instagram: [1200, 9, 2600], facebook: [800, 2, 900], tiktok: [450, 14, 5200], linkedin: [300, 3, 700] } as const;
  const socialRows = nets.flatMap((a) => Array.from({ length: 60 }, (_, i) => {
    const [f0, growth, reach] = base[a.platform];
    const wave = 1 + 0.35 * Math.sin(i / 3) + (i % 7 === 2 ? 0.6 : 0);
    return {
      accountId: a.id, day: dateISO(i - 59), followers: Math.round(f0 + growth * i + (i % 5)),
      reach: Math.round(reach * wave), engagements: Math.round(reach * wave * 0.06), profileViews: Math.round(reach * 0.02 * wave),
    };
  }));
  await db.insert(ops.socialDaily).values(socialRows);
  const camps = await db.insert(ops.adCampaigns).values([
    { platform: "instagram", externalId: "seed-c1", accountId: nets[0].id, name: "Demo psicólogos GDL", objective: "OUTCOME_LEADS", status: "ACTIVE", utmCampaign: "demo-psicologos-gdl" },
    { platform: "instagram", externalId: "seed-c2", accountId: nets[0].id, name: "Retargeting visitantes", objective: "OUTCOME_TRAFFIC", status: "ACTIVE" },
    { platform: "tiktok", externalId: "seed-c3", accountId: nets[2].id, name: "Memes de notas", objective: "REACH", status: "PAUSED" },
  ]).returning();
  await db.insert(ops.adDaily).values(camps.flatMap((c, k) => Array.from({ length: 30 }, (_, i) => ({
    campaignId: c.id, day: dateISO(i - 29), spendCents: (k === 2 && i > 20 ? 0 : 1) * (18000 + ((i * 37 + k * 11) % 9) * 2500),
    impressions: 6000 + ((i * 13) % 7) * 900, clicks: 60 + ((i * 7 + k) % 9) * 8, leads: k === 2 ? (i % 4 === 0 ? 1 : 0) : 1 + ((i + k) % 4),
  }))));

  // ---------- sugerencias de contenido ----------
  await db.insert(ops.contentSuggestions).values([
    { title: "Qué preguntar en la primera sesión con un adolescente", idea: "Carrusel con 5 preguntas de encuadre que Rafa usa en consulta, sin casos reales.", why: "Lo preguntan seguido en las demos con clínicas.", channel: "instagram", authorId: U("Rafa") },
    { title: "Cómo se ve Ziora en una clínica con 8 terapeutas", idea: "Video corto del flujo de una clínica: agenda, notas y reportes al director.", why: "Dos clínicas en negociación pidieron verlo.", channel: "linkedin", authorId: U("Euridice") },
  ]);

  await db.insert(ops.goals).values([
    { key: "ig_followers", label: "Seguidores Instagram", source: "Meta Insights", current: 182, targets: { d30: [150, 300], d60: [500, 800], d90: [1200, 2000] }, position: 1 },
    { key: "tiktok_followers", label: "Seguidores TikTok", source: "TikTok Analytics", current: 240, targets: { d30: [100, 400], d60: [400, 1200], d90: [800, 2500] }, position: 2 },
    { key: "reach", label: "Alcance mensual (IG + TikTok)", source: "Meta Insights, TikTok", current: 6800, targets: { d30: [5000, 15000], d60: [20000, 50000], d90: [40000, 100000] }, position: 3 },
    { key: "fb_posts", label: "Aportes en grupos de Facebook", source: "Registro en Contenido", auto: "fb_posts", targets: { d30: [15, 25], d60: [40, 60], d90: [60, 90] }, position: 4 },
    { key: "clicks", label: "Clics a la app o landing", source: "PostHog (UTM)", current: 64, targets: { d30: [50, 150], d60: [200, 500], d90: [400, 1000] }, position: 5 },
    { key: "signups", label: "Altas (signup_completed)", source: "PostHog", current: 6, targets: { d30: [5, 15], d60: [20, 40], d90: [40, 80] }, position: 6 },
    { key: "demos", label: "Demos agendadas", source: "Pipeline de demos", auto: "demos", targets: { d30: [2, 5], d60: [6, 12], d90: [10, 20] }, position: 7 },
    { key: "paid", label: "Pagos", source: "Pipeline de demos / Stripe", auto: "paid", targets: { d30: [0, 1], d60: [1, 4], d90: [3, 8] }, position: 8 },
  ]);

  console.log("Seed listo: equipo, tareas, demos, contactos, bugs, PRs, eventos, plantillas, campañas, contenido y metas.");
}

const TEMPLATE_INVITE = `<!doctype html>
<html lang="es"><body style="margin:0;background:#F7F6F0;font-family:Arial,Helvetica,sans-serif;color:#1A2520">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F6F0;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #E7E5DC">
  <tr><td style="background:linear-gradient(120deg,#B9EED0,#D4F5EC 55%,#C8F1EA);padding:36px 32px">
    <p style="margin:0 0 18px;font-size:18px;font-weight:800;color:#1F4A45">Ziora Copilot</p>
    <p style="margin:0;font-size:13px;font-weight:700;color:#4F6F5F;letter-spacing:.06em;text-transform:uppercase">Invitación</p>
    <p style="margin:6px 0 0;font-size:28px;line-height:1.15;font-weight:800;color:#1A2520">{{evento | Nuestro próximo evento}}</p>
    <p style="margin:10px 0 0;font-size:14px;color:#4F6F5F">{{evento_fecha}} · Ciudad de México</p>
  </td></tr>
  <tr><td style="padding:32px">
    <p style="margin:0 0 14px;font-size:17px;font-weight:700">Hola, {{nombre | colega}}</p>
    <p style="margin:0 0 14px;font-size:15px;line-height:1.65;color:#4B5563">Reunimos a psicólogas y psicólogos que quieren dedicar menos horas al papeleo y más a la conexión humana. Habrá demos en vivo, una charla corta sobre qué dice la evidencia de la IA en notas clínicas y espacio para conversar.</p>
    <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#4B5563">El cupo es limitado. Si quieres venir, aparta tu lugar:</p>
    <a href="{{{evento_registro}}}" style="display:inline-block;background:#4E6B5C;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px">Apartar mi lugar →</a>
    <p style="margin:28px 0 0;font-size:13px;line-height:1.6;color:#9CA3AF">Ziora es un asistente administrativo: la IA propone un borrador y tú lo revisas y apruebas.</p>
  </td></tr>
  <tr><td style="padding:18px 32px;border-top:1px solid #EFEDE6;font-size:11px;line-height:1.6;color:#9CA3AF">
    Recibes este correo porque aceptaste recibir invitaciones de Ziora. <a href="{{{baja}}}" style="color:#9CA3AF">Darme de baja</a> · <a href="https://www.ziora-copilot.com" style="color:#9CA3AF">ziora-copilot.com</a>
  </td></tr>
</table></td></tr></table></body></html>`;

const TEMPLATE_WELCOME = TEMPLATE_INVITE
  .replace("Invitación", "Bienvenida")
  .replace("{{evento | Nuestro próximo evento}}", "Tu prueba de Pro ya empezó")
  .replace("{{evento_fecha}} · Ciudad de México", "3 pasos para tu primer borrador de nota")
  .replace(/Reunimos a psicólogas[\s\S]*?conversar\./, "1. Graba tu sesión (con el consentimiento de tu paciente). 2. Revisa el borrador en SOAP, DAP o BIRP. 3. Apruébalo y descarga tu PDF.")
  .replace("El cupo es limitado. Si quieres venir, aparta tu lugar:", "Si quieres, agenda 25 minutos con nuestro equipo clínico:")
  .replace("{{{evento_registro}}}", "https://www.ziora-copilot.com/demo")
  .replace("Apartar mi lugar →", "Agendar demo →");

const TEMPLATE_NEWS = TEMPLATE_INVITE
  .replace("Invitación", "Novedades")
  .replace("{{evento | Nuestro próximo evento}}", "Lo nuevo en Ziora este mes")
  .replace("{{evento_fecha}} · Ciudad de México", "Octubre 2026")
  .replace(/Reunimos a psicólogas[\s\S]*?conversar\./, "Escalas PHQ-9 y GAD-7 con evolución sesión a sesión, PDF NOM-004 con tu logo y cédula, y un portal para que tu paciente se lleve algo de cada sesión.")
  .replace("El cupo es limitado. Si quieres venir, aparta tu lugar:", "Pruébalo hoy:")
  .replace("{{{evento_registro}}}", "https://app.ziora-copilot.com")
  .replace("Apartar mi lugar →", "Abrir Ziora →");

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => client.end());
