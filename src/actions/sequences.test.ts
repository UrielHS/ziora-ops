import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requirePermission: vi.fn(async () => ({ user: { id: "11111111-1111-4111-8111-111111111111", name: "Uriel Prueba" } })) }));
vi.mock("@/domain/leads", () => ({ stopActiveEnrollments: vi.fn(async () => 1) }));
vi.mock("@/domain/sequences", async (importOriginal) => ({ ...(await importOriginal<object>()), enroll: vi.fn() }));

const { enroll } = await import("@/domain/sequences");
const { stopActiveEnrollments } = await import("@/domain/leads");
const { enrollAction, stopEnrollmentAction } = await import("./sequences");

const SEQ = "22222222-2222-4222-8222-222222222222";
const ID1 = "33333333-3333-4333-8333-333333333333";
const ID2 = "44444444-4444-4444-8444-444444444444";

describe("acciones de cadencia", () => {
  beforeEach(() => {
    vi.mocked(enroll).mockReset();
    vi.mocked(stopActiveEnrollments).mockClear();
  });

  it("enrollAction exige al menos un lead y una secuencia", async () => {
    const fd = new FormData();
    fd.append("sequenceId", SEQ);
    expect((await enrollAction({}, fd)).error).toMatch(/elige al menos un lead/);
    const fd2 = new FormData();
    fd2.append("ids[]", ID1);
    expect((await enrollAction({}, fd2)).error).toMatch(/sequenceId/);
    expect(enroll).not.toHaveBeenCalled();
  });

  it("enrollAction resume enrolados y omitidos", async () => {
    vi.mocked(enroll).mockResolvedValue({ enrolled: 1, skipped: [{ contactId: ID2, reason: "estado" }] });
    const fd = new FormData();
    fd.append("sequenceId", SEQ);
    fd.append("ids[]", ID1);
    fd.append("ids[]", ID2);
    const r = await enrollAction({}, fd);
    expect(r.message).toBe("1 lead(s) enrolado(s) · 1 omitido(s) (ya enrolados o fuera de nuevo/contactado)");
    expect(enroll).toHaveBeenCalledWith(expect.anything(), [ID1, ID2], SEQ, { userId: "11111111-1111-4111-8111-111111111111", label: "Uriel Prueba" });
  });

  it("stopEnrollmentAction detiene a mano", async () => {
    const fd = new FormData();
    fd.append("id", ID1);
    expect((await stopEnrollmentAction({}, fd)).message).toBe("Secuencia detenida");
    expect(stopActiveEnrollments).toHaveBeenCalledWith(expect.anything(), ID1, "manual");
  });
});
