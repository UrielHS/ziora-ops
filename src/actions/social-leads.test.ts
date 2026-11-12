import { beforeEach, describe, expect, it, vi } from "vitest";

const add = vi.fn();
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn(), unstable_rethrow: vi.fn() }));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/session", () => ({ requirePermission: async () => ({ user: { id: "u1", name: "Ale" } }) }));
vi.mock("@/domain/social-dm", () => ({ recordDm: vi.fn() }));
vi.mock("@/domain/social-leads", () => ({ addContactChannel: (...a: unknown[]) => add(...a), setSocialLeadType: vi.fn() }));

const ID = "11111111-1111-4111-8111-111111111111";
const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

describe("addContactChannelAction", () => {
  beforeEach(() => { add.mockReset(); vi.spyOn(console, "error").mockImplementation(() => {}); });

  it("rechaza un correo mal escrito sin tocar el dominio", async () => {
    const { addContactChannelAction } = await import("./social-leads");
    const r = await addContactChannelAction({}, form({ id: ID, email: "ana" }));
    expect(r.error).toMatch(/correo/);
    expect(add).not.toHaveBeenCalled();
  });

  it("campo vacío = no enviado", async () => {
    const { addContactChannelAction } = await import("./social-leads");
    const r = await addContactChannelAction({}, form({ id: ID, email: "" }));
    expect(r.error).toMatch(/correo o un teléfono/);
  });

  it("responde según lo que pasó de verdad", async () => {
    const { addContactChannelAction } = await import("./social-leads");
    add.mockResolvedValueOnce({ ok: true, added: true, unreadablePhone: false });
    expect((await addContactChannelAction({}, form({ id: ID, email: "a@b.com" }))).message).toBe("Dato agregado");
    add.mockResolvedValueOnce({ ok: true, added: false, unreadablePhone: false });
    expect((await addContactChannelAction({}, form({ id: ID, email: "a@b.com" }))).message).toBe("Ya lo tenía");
    add.mockResolvedValueOnce({ ok: true, added: false, unreadablePhone: true });
    expect((await addContactChannelAction({}, form({ id: ID, phone: "abc" }))).error).toBe("No se pudo leer el teléfono");
    add.mockResolvedValueOnce({ ok: false, takenBy: "x" });
    const r = await addContactChannelAction({}, form({ id: ID, email: "a@b.com" }));
    expect(r.error).toMatch(/otro contacto/);
    expect(JSON.stringify(r)).not.toContain('"x"');
  });
});
