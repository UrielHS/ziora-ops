/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base con ambos schemas. */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";
const actor = { userId: null, label: "prueba" };

describe.runIf(enabled)("leads: estados, actividades y toques", () => {
  it("un toque pasa nuevo→contactado y deja actividad; un avance no retrocede; perdido exige motivo", async () => {
    const { db } = await import("@/db");
    const { contactActivities, contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { advanceLead, recordTouch, setLeadStatus } = await import("./leads");
    const t = Date.now();
    const { id } = await upsertContact(db, { name: "Lead Prueba", email: `lead${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "nuevo" });

    await recordTouch(db, id, "whatsapp", actor, "Primer mensaje");
    let [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBe("contactado");
    expect(c.lastContactAt).not.toBeNull();

    expect(await advanceLead(db, id, "pago", actor)).toBe(true);
    expect(await advanceLead(db, id, "en_trial", actor)).toBe(false);
    [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBe("pago");

    await expect(setLeadStatus(db, id, "perdido", actor)).rejects.toThrow("Indica el motivo");
    await setLeadStatus(db, id, "perdido", actor, { lostReason: "No le interesa" });
    [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c).toMatchObject({ leadStatus: "perdido", lostReason: "No le interesa" });

    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, id));
    expect(acts.map((a) => a.type)).toEqual(expect.arrayContaining(["whatsapp", "cambio_estado"]));
    expect(acts.filter((a) => a.type === "cambio_estado")).toHaveLength(3); // contactado, pago, perdido
    expect(acts.find((a) => a.type === "whatsapp")).toMatchObject({ direction: "saliente", actorLabel: "prueba", summary: "Primer mensaje" });
  });

  it("«le mandé mi liga» deja nota saliente y pone siguiente paso a 2 días solo si no había", async () => {
    const { db } = await import("@/db");
    const { contactActivities, contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { recordReferralLinkSent, setNextAction } = await import("./leads");
    const t = Date.now();
    const now = new Date("2026-11-10T16:00:00-06:00");
    const { id } = await upsertContact(db, { name: "Liga Prueba", email: `liga${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "contactado" });
    await recordReferralLinkSent(db, id, actor, now);
    let [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c).toMatchObject({ nextAction: "Ver si ya se registró", nextActionOn: "2026-11-12" });
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, id));
    expect(acts.find((x) => (x.meta as { kind?: string })?.kind === "referral_link")).toMatchObject({ type: "nota", direction: "saliente", summary: "Le mandé mi liga de prueba (referido)" });
    await setNextAction(db, id, { text: "Llamar", on: "2026-11-20" }, actor);
    await recordReferralLinkSent(db, id, actor, now);
    [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c).toMatchObject({ nextAction: "Llamar", nextActionOn: "2026-11-20" }); // no pisa el que ya había
  });

  it("marcar correo o teléfono incorrecto deja la fecha y una nota; desmarcar la quita", async () => {
    const { db } = await import("@/db");
    const { contactActivities, contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { setChannelInvalid } = await import("./leads");
    const t = Date.now();
    const { id } = await upsertContact(db, { name: "Mal Dato", email: `mal${t}@example.com`, phone: "55 1234 5678", source: "manual", tags: ["lead"], leadStatus: "nuevo" });
    await setChannelInvalid(db, id, "email", true, actor);
    await setChannelInvalid(db, id, "phone", true, actor);
    let [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.emailInvalidAt).toBeInstanceOf(Date);
    expect(c.phoneInvalidAt).toBeInstanceOf(Date);
    expect(c.email).toBe(`mal${t}@example.com`); // el dato no se borra
    await setChannelInvalid(db, id, "email", false, actor);
    [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.emailInvalidAt).toBeNull();
    const acts = (await db.select().from(contactActivities).where(eq(contactActivities.contactId, id))).map((x) => x.summary);
    expect(acts).toEqual(expect.arrayContaining(["Marcó el correo como incorrecto", "Marcó el teléfono como incorrecto", "Marcó el correo como válido otra vez"]));
  });

  it("«ya lo está probando» pasa a en_trial y no retrocede a quien ya paga", async () => {
    const { db } = await import("@/db");
    const { contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { markTrying, advanceLead } = await import("./leads");
    const t = Date.now();
    const { id } = await upsertContact(db, { name: "Trial Prueba", email: `trial${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "nuevo" });
    expect(await markTrying(db, id, actor)).toEqual({ ok: true });
    let [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBe("en_trial");
    expect(await markTrying(db, id, actor)).toMatchObject({ ok: false, message: expect.stringMatching(/ya está/i) });
    await advanceLead(db, id, "pago", actor);
    expect(await markTrying(db, id, actor)).toMatchObject({ ok: false });
    [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBe("pago");
  });

  it("respondió, dueño, prioridad y siguiente paso quedan en el contacto y en el timeline", async () => {
    const { db } = await import("@/db");
    const { contactActivities, contacts } = await import("@/db/schema");
    const { users } = await import("@/db/shared");
    const { upsertContact } = await import("./contacts");
    const { assignOwner, markReplied, setNextAction, setPriority } = await import("./leads");
    const t = Date.now();
    const { id } = await upsertContact(db, { name: "Lead Dos", email: `lead2${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "nuevo" });
    const [someone] = await db.select({ id: users.id, name: users.name }).from(users).limit(1);

    await markReplied(db, id, actor, "Dijo que sí le interesa");
    await assignOwner(db, [id], someone.id, actor);
    await setPriority(db, [id], 1, actor);
    await setNextAction(db, id, { text: "Proponer demo", on: "2026-11-12" }, actor);

    const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c).toMatchObject({ leadStatus: "respondio", ownerId: someone.id, priority: 1, nextAction: "Proponer demo", nextActionOn: "2026-11-12" });
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, id));
    expect(acts.find((a) => a.direction === "entrante")?.summary).toBe("Dijo que sí le interesa");
    expect(acts.some((a) => a.type === "sistema" && a.summary.includes(someone.name))).toBe(true);
  });

  it("demo agendada avanza al lead y cancelar no lo retrocede", async () => {
    const { db } = await import("@/db");
    const { contactActivities, contacts } = await import("@/db/schema");
    const { applyWebhookDemo } = await import("./demos");
    const { advanceLead } = await import("./leads");
    const t = Date.now();
    const email = `demo${t}@example.com`;
    await applyWebhookDemo(db, { externalId: `x${t}`, fullName: "Demo Lead", email, scheduledAt: new Date(Date.now() + 86400000), source: "test" });
    let [c] = await db.select().from(contacts).where(eq(contacts.email, email));
    expect(c.leadStatus).toBe("demo_agendada");
    await advanceLead(db, c.id, "en_trial", actor);
    await applyWebhookDemo(db, { externalId: `x${t}`, fullName: "Demo Lead", email, source: "test", status: "cancelled" });
    [c] = await db.select().from(contacts).where(eq(contacts.email, email));
    expect(c.leadStatus).toBe("en_trial");
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, c.id));
    expect(acts.filter((a) => a.type === "demo").map((a) => a.summary)).toEqual([expect.stringContaining("Demo agendada"), "Canceló la demo"]);
  });

  it("el sync de usuarios sube a en_trial y pago sin importar mayúsculas y nunca baja", async () => {
    const { db } = await import("@/db");
    const { appUsers, contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { syncLeadStatusFromAppUsers } = await import("./leads");
    const t = Date.now();
    const email = `app${t}@example.com`;
    const { id } = await upsertContact(db, { name: "App Lead", email, source: "manual", tags: ["lead"], leadStatus: "contactado" });
    await db.insert(appUsers).values({ uid: `u${t}`, email: ` ${email.toUpperCase()} `, plan: "pro", status: "trialing", syncedAt: new Date() });
    // La base local puede tener otros leads que también avanzan: se afirma sobre este contacto y cotas mínimas.
    const status = async () => (await db.select({ s: contacts.leadStatus }).from(contacts).where(eq(contacts.id, id)))[0].s;
    expect((await syncLeadStatusFromAppUsers(db)).trial).toBeGreaterThanOrEqual(1);
    expect(await status()).toBe("en_trial");
    await db.update(appUsers).set({ status: "active", mrrCents: 69900, currency: "mxn" }).where(eq(appUsers.uid, `u${t}`));
    expect((await syncLeadStatusFromAppUsers(db)).paid).toBeGreaterThanOrEqual(1);
    expect(await status()).toBe("pago");
    await db.update(appUsers).set({ status: "trialing", mrrCents: null }).where(eq(appUsers.uid, `u${t}`));
    expect(await syncLeadStatusFromAppUsers(db)).toEqual({ trial: 0, paid: 0 }); // ya nadie avanza; nunca se baja
    expect(await status()).toBe("pago");
  });

  it("la baja de correo marca perdido:baja salvo a quien ya está en trial o pagando", async () => {
    const { db } = await import("@/db");
    const { contacts } = await import("@/db/schema");
    const { optOut, upsertContact } = await import("./contacts");
    const t = Date.now();
    const a = await upsertContact(db, { name: "Baja A", email: `bajaa${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "contactado" });
    const b = await upsertContact(db, { name: "Baja B", email: `bajab${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "pago" });
    await optOut(db, a.id);
    await optOut(db, b.id);
    const [ca] = await db.select().from(contacts).where(eq(contacts.id, a.id));
    const [cb] = await db.select().from(contacts).where(eq(contacts.id, b.id));
    expect(ca).toMatchObject({ leadStatus: "perdido", lostReason: "baja" });
    expect(cb.leadStatus).toBe("pago");
  });

  it("el timeline une actividades y demos, de lo más reciente a lo más viejo, con el toque arriba", async () => {
    const { db } = await import("@/db");
    const { demoRequests } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { loadTimeline, recordTouch } = await import("./leads");
    const t = Date.now();
    const email = `tl${t}@example.com`;
    const { id } = await upsertContact(db, { name: "Timeline Lead", email, source: "manual", tags: ["lead"], leadStatus: "nuevo" });
    await db.insert(demoRequests).values({ contactId: id, fullName: "Timeline Lead", email, source: "test", stage: "scheduled", scheduledAt: new Date("2026-11-20T17:00:00Z") });
    await recordTouch(db, id, "whatsapp", actor, "Hola por WhatsApp");

    const items = await loadTimeline(db, id);
    expect(items.length).toBeGreaterThanOrEqual(3); // toque, cambio de estado, demo
    for (let i = 1; i < items.length; i++) expect(items[i - 1].at.getTime()).toBeGreaterThanOrEqual(items[i].at.getTime());
    expect(items[0]).toMatchObject({ kind: "whatsapp", title: "Hola por WhatsApp", actor: "prueba" });
    expect(items.some((i) => i.kind === "demo" && i.title.includes("Agendada"))).toBe(true);
  });

  it("convertir un lead en cuenta crea la cuenta una sola vez, lo liga como decisor y deja actividad", async () => {
    const { db } = await import("@/db");
    const { accountContacts, accounts, contactActivities, contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { convertLeadToAccount } = await import("./leads");
    const t = Date.now();
    const { id } = await upsertContact(db, {
      name: "Dir. Prueba", email: `dir${t}@example.com`, source: "manual", tags: ["lead", "clinic"], leadStatus: "respondio",
      company: `Clínica Prueba ${t}`, jobTitle: "Directora", cityName: "Querétaro",
    });

    const first = await convertLeadToAccount(db, id, actor);
    const second = await convertLeadToAccount(db, id, actor);
    expect(first.created).toBe(true);
    expect(second).toEqual({ accountId: first.accountId, created: false });

    const [acc] = await db.select().from(accounts).where(eq(accounts.id, first.accountId));
    expect(acc).toMatchObject({ name: `Clínica Prueba ${t}`, type: "clinic", city: "Querétaro" });
    const links = await db.select().from(accountContacts).where(eq(accountContacts.contactId, id));
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ accountId: first.accountId, title: "Directora", decisionMaker: true });
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, id));
    expect(acts.filter((a) => a.type === "sistema" && (a.meta as { accountId?: string }).accountId === first.accountId)).toHaveLength(1);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBe("respondio"); // convertir no cambia el estado del lead
  });

  it("un rebote de correo quita el permiso y deja nota sin perder el lead; una queja sí lo marca perdido", async () => {
    const { db } = await import("@/db");
    const { contactActivities, contactConsents, contacts } = await import("@/db/schema");
    const { emailBounced, optOutByEmail, upsertContact } = await import("./contacts");
    const t = Date.now();
    const email = `rebote${t}@example.com`;
    const { id } = await upsertContact(db, { name: "Rebote", email, source: "manual", tags: ["lead"], leadStatus: "contactado", consents: [{ channel: "email", source: "evento_luma" }] });

    await emailBounced(db, email);
    const [c1] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c1.leadStatus).toBe("contactado");
    const [k] = await db.select().from(contactConsents).where(eq(contactConsents.contactId, id));
    expect(k).toMatchObject({ channel: "email", optIn: false });
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, id));
    expect(acts.some((a) => a.type === "sistema" && /rebot/i.test(a.summary))).toBe(true);

    await optOutByEmail(db, email);
    const [c2] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c2).toMatchObject({ leadStatus: "perdido", lostReason: "baja" });
  });

  it("el sync de usuarios no convierte en lead a un contacto que no lo es", async () => {
    const { db } = await import("@/db");
    const { appUsers, contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { syncLeadStatusFromAppUsers } = await import("./leads");
    const t = Date.now();
    const email = `equipo${t}@example.com`;
    const { id } = await upsertContact(db, { name: "Del Equipo", email, source: "manual", tags: [] });
    await db.insert(appUsers).values({ uid: `e${t}`, email, plan: "pro", status: "trialing", syncedAt: new Date() });
    await syncLeadStatusFromAppUsers(db);
    const [c] = await db.select().from(contacts).where(eq(contacts.id, id));
    expect(c.leadStatus).toBeNull();
  });

  it("cambiar la etapa de una demo avanza al lead igual que arrastrarla; perderla solo deja actividad", async () => {
    const { db } = await import("@/db");
    const { contactActivities, contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { leadFromDemoStage } = await import("./demos");
    const t = Date.now();
    const { id } = await upsertContact(db, { name: "Demo Etapa", email: `etapa${t}@example.com`, source: "manual", tags: ["lead"], leadStatus: "respondio" });
    await leadFromDemoStage(db, id, "trial", actor);
    expect((await db.select().from(contacts).where(eq(contacts.id, id)))[0].leadStatus).toBe("en_trial");
    await leadFromDemoStage(db, id, "lost", actor);
    expect((await db.select().from(contacts).where(eq(contacts.id, id)))[0].leadStatus).toBe("en_trial");
    const acts = await db.select().from(contactActivities).where(eq(contactActivities.contactId, id));
    expect(acts.some((a) => a.type === "demo" && a.summary === "Demo perdida")).toBe(true);
  });
});
