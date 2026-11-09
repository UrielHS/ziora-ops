import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requirePermission: vi.fn(async () => ({ user: { id: "11111111-1111-4111-8111-111111111111", name: "Uriel Prueba" } })) }));
vi.mock("@/domain/leads", () => ({
  assignOwner: vi.fn(), convertLeadToAccount: vi.fn(), logActivity: vi.fn(), markReplied: vi.fn(), recordTouch: vi.fn(),
  setLeadStatus: vi.fn(), setNextAction: vi.fn(), setPriority: vi.fn(),
}));
vi.mock("@/domain/sequences", async (importOriginal) => ({ ...(await importOriginal<object>()), enroll: vi.fn(), completePendingTouch: vi.fn(async () => true) }));

const { enroll, completePendingTouch } = await import("@/domain/sequences");
const { recordTouch } = await import("@/domain/leads");
const { bulkLeadsAction, recordTouchAction } = await import("./leads");

const SEQ = "22222222-2222-4222-8222-222222222222";
const ID1 = "33333333-3333-4333-8333-333333333333";

describe("acciones de leads con cadencia", () => {
  beforeEach(() => {
    vi.mocked(enroll).mockReset();
    vi.mocked(completePendingTouch).mockClear();
    vi.mocked(recordTouch).mockClear();
  });

  it("la acción masiva 'enroll' exige secuencia y enrola a los seleccionados", async () => {
    const fd = new FormData();
    fd.append("ids[]", ID1);
    fd.append("op", "enroll");
    expect((await bulkLeadsAction({}, fd)).error).toMatch(/secuencia/i);
    expect(enroll).not.toHaveBeenCalled();
    fd.append("sequenceId", SEQ);
    vi.mocked(enroll).mockResolvedValue({ enrolled: 1, skipped: [] });
    expect((await bulkLeadsAction({}, fd)).message).toBe("1 lead(s) enrolado(s)");
    expect(enroll).toHaveBeenCalledWith(expect.anything(), [ID1], SEQ, expect.objectContaining({ label: "Uriel Prueba" }));
  });

  it("'Ya lo mandé' por WhatsApp registra el toque y completa el paso pendiente de la secuencia", async () => {
    const fd = new FormData();
    fd.append("id", ID1);
    fd.append("channel", "whatsapp");
    expect((await recordTouchAction({}, fd)).message).toBe("Toque registrado");
    expect(recordTouch).toHaveBeenCalled();
    expect(completePendingTouch).toHaveBeenCalledWith(expect.anything(), ID1, "whatsapp");
  });

  it("una llamada no completa pasos de la secuencia", async () => {
    const fd = new FormData();
    fd.append("id", ID1);
    fd.append("channel", "llamada");
    await recordTouchAction({}, fd);
    expect(completePendingTouch).not.toHaveBeenCalled();
  });
});
