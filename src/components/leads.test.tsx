import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/leads", () => ({
  addNoteAction: vi.fn(), markRepliedAction: vi.fn(), moveLead: vi.fn(), postponeAction: vi.fn(), recordTouchAction: vi.fn(),
  setLeadStatusAction: vi.fn(), setNextActionAction: vi.fn(),
}));
vi.mock("@/actions/sequences", () => ({ enrollAction: vi.fn(), stopEnrollmentAction: vi.fn() }));

const { TodayRow, CadencePanel } = await import("./leads");

const lead = {
  id: "33333333-3333-4333-8333-333333333333", name: "Ana López", priority: 2, leadStatus: "contactado", jobTitle: "Psicóloga",
  nextAction: "Toque 2 de 4 · WhatsApp", nextActionOn: "2026-11-10", phoneE164: "5215512345678",
} as unknown as Parameters<typeof TodayRow>[0]["c"];

const cadence = {
  enrollmentId: "e1", sequenceName: "MTW 4 toques", status: "activa" as const, touches: 1, total: 4,
  nextRunAt: null, nextChannel: "whatsapp" as const, pendingText: "Hola Ana, soy Uriel", stopReason: null,
};

describe("TodayRow con cadencia", () => {
  it("con WhatsApp pendiente muestra el toque y el texto de la secuencia en vez del mensaje sugerido", () => {
    const html = renderToStaticMarkup(<TodayRow c={lead} owner="Uriel" message="mensaje por defecto" wa={null} cadence={cadence} />);
    expect(html).toContain("Toque 2 de 4 · WhatsApp");
    expect(html).toContain("Hola Ana, soy Uriel");
    expect(html).not.toContain("mensaje por defecto");
  });

  it("con secuencia activa sin pendiente indica el siguiente paso", () => {
    const html = renderToStaticMarkup(<TodayRow c={lead} owner="Uriel" message="mensaje por defecto" wa={null} cadence={{ ...cadence, pendingText: null, nextChannel: "email", nextRunAt: new Date("2026-11-13T16:00:00Z") }} />);
    expect(html).toContain("MTW 4 toques");
    expect(html).toContain("Correo");
    expect(html).toContain("mensaje por defecto");
  });
});

describe("CadencePanel", () => {
  const seqs = [{ id: "22222222-2222-4222-8222-222222222222", name: "MTW 4 toques" }];
  it("sin secuencia activa ofrece enrolar", () => {
    const html = renderToStaticMarkup(<CadencePanel contactId={lead.id} cadence={undefined} sequences={seqs} canManage />);
    expect(html).toContain("Enrolar");
    expect(html).toContain("MTW 4 toques");
  });
  it("con secuencia activa muestra toques y permite detener", () => {
    const html = renderToStaticMarkup(<CadencePanel contactId={lead.id} cadence={cadence} sequences={seqs} canManage />);
    expect(html).toContain("1 de 4");
    expect(html).toContain("Detener");
    expect(html).not.toContain("Enrolar");
  });
  it("terminada muestra el motivo y vuelve a ofrecer enrolar", () => {
    const html = renderToStaticMarkup(<CadencePanel contactId={lead.id} cadence={{ ...cadence, status: "terminada", stopReason: "completada", nextChannel: null, pendingText: null }} sequences={seqs} canManage />);
    expect(html).toContain("Terminada");
    expect(html).toContain("Enrolar");
  });
});
