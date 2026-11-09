/** Corre con RUN_DB_TESTS=1 y DATABASE_URL apuntando a una base con ambos schemas (public de Event Ops y ops). */
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

const enabled = !!process.env.DATABASE_URL && process.env.RUN_DB_TESTS === "1";

describe.runIf(enabled)("contactos propios e importación de Event Ops", () => {
  it("copia una vez, no duplica, completa lo que falta y no toca Event Ops", async () => {
    const { db } = await import("@/db");
    const { contacts, contactTags } = await import("@/db/schema");
    const { eoContacts, eoContactTags, organizations } = await import("@/db/shared");
    const { importFromEventOps, upsertContact } = await import("./contacts");
    const t = Date.now();

    const [org] = await db.insert(organizations).values({ name: `Clínica Prueba ${t}` }).returning();
    const [a] = await db.insert(eoContacts).values({ type: "person", name: "Ana EO", email: `ana.eo${t}@example.com`, phone: "+52 55 1111 2222", city: "cdmx", organizationId: org.id, source: "luma" }).returning();
    const [b] = await db.insert(eoContacts).values({ type: "person", name: "Beto EO", email: `beto.eo${t}@example.com`, phone: "+52 33 3333 4444", city: "gdl", source: "manual" }).returning();
    const [sinCorreo] = await db.insert(eoContacts).values({ type: "person", name: "Sin correo", source: "manual" }).returning();
    await db.insert(eoContactTags).values([{ contactId: a.id, tag: "attendee" }, { contactId: a.id, tag: "venue" }]);

    // Beto ya existía en Ziora Ops con otro teléfono: se conserva el suyo y se completa la ciudad.
    await upsertContact(db, { name: "Beto Ziora", email: `BETO.EO${t}@example.com`, phone: "+52 81 0000 0000", source: "manual", tags: ["lead"] });

    const r = await importFromEventOps(db, [a.id, b.id, sinCorreo.id]);
    expect(r).toEqual({ created: 1, completed: 1, skipped: 1 });

    const [ana] = await db.select().from(contacts).where(eq(contacts.eventOpsContactId, a.id));
    expect(ana).toMatchObject({ name: "Ana EO", company: org.name, city: "cdmx", source: "event_ops" });
    const anaTags = (await db.select().from(contactTags).where(eq(contactTags.contactId, ana.id))).map((x) => x.tag);
    expect(anaTags).toEqual(["attendee"]); // "venue" no existe en Ziora Ops y se ignora

    const [beto] = await db.select().from(contacts).where(eq(contacts.email, `beto.eo${t}@example.com`));
    expect(beto).toMatchObject({ name: "Beto Ziora", phone: "+52 81 0000 0000", city: "gdl", eventOpsContactId: b.id });

    // Importar de nuevo no duplica.
    expect(await importFromEventOps(db, [a.id])).toEqual({ created: 0, completed: 1, skipped: 0 });
    expect((await db.select().from(contacts).where(eq(contacts.eventOpsContactId, a.id))).length).toBe(1);

    // Editar en Ziora Ops no cambia Event Ops.
    await db.update(contacts).set({ name: "Ana editada" }).where(eq(contacts.id, ana.id));
    const [anaEo] = await db.select().from(eoContacts).where(eq(eoContacts.id, a.id));
    expect(anaEo.name).toBe("Ana EO");
  });

  it("importa la hoja de leads: crea, completa sin pisar y no duplica", async () => {
    const { db } = await import("@/db");
    const { contacts, contactTags } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const { importLeadSheet, parseLeadSheet } = await import("./lead-sheet");
    const t = Date.now();
    await upsertContact(db, { name: "Dani Ya Existía", email: `dani${t}@example.com`, phone: "+52 1", source: "manual", tags: [] });
    const csv = `Prioridad,Nombre,Email,Teléfono,Rol,Pacientes/sem,Ciudad,Asistió Panel
2,Dani Hoja,dani${t}@example.com,52999,Psicólogo/a en clínica o consultorio,6 a 10,Cdmx,Sí
3,Eli Hoja,eli${t}@example.com,52888,Otro,0,Monterrey,`;
    const { rows } = parseLeadSheet(csv);
    expect(await importLeadSheet(db, rows)).toEqual({ created: 1, completed: 1, enrolled: 0 });
    expect(await importLeadSheet(db, rows)).toEqual({ created: 0, completed: 2, enrolled: 0 });

    const [dani] = await db.select().from(contacts).where(eq(contacts.email, `dani${t}@example.com`));
    expect(dani).toMatchObject({ name: "Dani Ya Existía", phone: "+52 1", jobTitle: "Psicólogo/a en clínica o consultorio", patientsPerWeek: "6 a 10", city: "cdmx", cityName: "Cdmx" });
    expect(dani).toMatchObject({ priority: 2, leadStatus: "nuevo", details: { eventos: { panel: true, taller: false } } }); // Prioridad y asistencia sí se guardan (CRM)
    const tags = (await db.select().from(contactTags).where(eq(contactTags.contactId, dani.id))).map((x) => x.tag).sort();
    expect(tags).toEqual(["lead", "psychologist"]);
    const [eli] = await db.select().from(contacts).where(eq(contacts.email, `eli${t}@example.com`));
    expect(eli).toMatchObject({ source: "sheet_import", city: "mty", cityName: "Monterrey", jobTitle: "Otro" });
  });

  it("importa solo-teléfono, deduplica por teléfono y no pisa estado ni prioridad al reimportar", async () => {
    const { db } = await import("@/db");
    const { contactConsents, contacts } = await import("@/db/schema");
    const { importLeadSheet, parseLeadSheet } = await import("./lead-sheet");
    const t = Date.now().toString().slice(-8);
    const csv = `Prioridad,Segmento,Nombre,Email,Teléfono
2,🟠 WARM-A,Tel Uno,,55${t}
`;
    const r1 = await importLeadSheet(db, parseLeadSheet(csv).rows, { consentSource: "evento_luma" });
    expect(r1).toEqual({ created: 1, completed: 0, enrolled: 0 });
    const [c] = await db.select().from(contacts).where(eq(contacts.phoneE164, `5255${t}`));
    expect(c).toMatchObject({ email: null, leadStatus: "nuevo", priority: 2, segment: "WARM-A" });
    const cons = await db.select().from(contactConsents).where(eq(contactConsents.contactId, c.id));
    expect(cons.map((x) => [x.channel, x.optIn, x.source]).sort()).toEqual([["email", true, "evento_luma"], ["whatsapp", true, "evento_luma"]]);

    await db.update(contacts).set({ leadStatus: "contactado", priority: 1 }).where(eq(contacts.id, c.id));
    const r2 = await importLeadSheet(db, parseLeadSheet(csv.replace(`55${t}`, `+52 55 ${t}`)).rows, { consentSource: "evento_luma" });
    expect(r2).toEqual({ created: 0, completed: 1, enrolled: 0 });
    const [again] = await db.select().from(contacts).where(eq(contacts.id, c.id));
    expect(again).toMatchObject({ leadStatus: "contactado", priority: 1 });
  });

  it("dos correos distintos con el mismo teléfono: el segundo queda sin phone_e164 y con nota, nunca rompe", async () => {
    const { db } = await import("@/db");
    const { contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const t = Date.now().toString().slice(-8);
    const a = await upsertContact(db, { name: "Tel A", email: `tela${t}@example.com`, phone: `+52 33 ${t}`, source: "manual", tags: [] });
    const b = await upsertContact(db, { name: "Tel B", email: `telb${t}@example.com`, phone: `5233${t}`, source: "manual", tags: [] });
    const [ca] = await db.select().from(contacts).where(eq(contacts.id, a.id));
    const [cb] = await db.select().from(contacts).where(eq(contacts.id, b.id));
    expect(ca.phoneE164).toBe(`5233${t}`);
    expect(cb).toMatchObject({ phoneE164: null, phone: `5233${t}`, details: { telefono_duplicado_de: a.id } });
  });

  it("un lead solo-teléfono al que después le agregan correo se completa, no se duplica", async () => {
    const { db } = await import("@/db");
    const { contacts } = await import("@/db/schema");
    const { upsertContact } = await import("./contacts");
    const t = Date.now().toString().slice(-8);
    const a = await upsertContact(db, { name: "Solo Tel", phone: `55${t}`, source: "sheet_import", tags: ["lead"], leadStatus: "nuevo" });
    await db.update(contacts).set({ leadStatus: "contactado" }).where(eq(contacts.id, a.id));
    const b = await upsertContact(db, { name: "Solo Tel", email: `solotel${t}@example.com`, phone: `+52 55 ${t}`, source: "sheet_import", tags: ["lead"], leadStatus: "nuevo" });
    expect(b).toEqual({ id: a.id, created: false });
    const rows = await db.select().from(contacts).where(eq(contacts.phoneE164, `5255${t}`));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ email: `solotel${t}@example.com`, leadStatus: "contactado" });
    const dup = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.email, `solotel${t}@example.com`));
    expect(dup).toHaveLength(1);
  });
});
