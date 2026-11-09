import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/domain/sequences", () => ({
  runSequences: vi.fn(async () => ({ sent: 2, pendingWhatsapp: 1, skipped: 0, finished: 0, stopped: 0 })),
  inSendingWindow: vi.fn(() => true),
  EMAIL_LIMIT_PER_RUN: 200,
}));

const { runSequences, inSendingWindow } = await import("@/domain/sequences");
const { POST } = await import("./route");

const post = (headers: Record<string, string> = {}) => POST(new Request("http://x/api/jobs/run-sequences", { method: "POST", headers }));

describe("job run-sequences", () => {
  beforeEach(() => {
    process.env.JOB_SECRET = "s3cret";
    vi.mocked(runSequences).mockClear();
    vi.mocked(inSendingWindow).mockReturnValue(true);
  });

  it("401 sin Bearer", async () => {
    expect((await post()).status).toBe(401);
    expect(runSequences).not.toHaveBeenCalled();
  });

  it("con Bearer llama runSequences con límite 200 y devuelve los conteos", async () => {
    const res = await post({ authorization: "Bearer s3cret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sent: 2, pendingWhatsapp: 1 });
    expect(runSequences).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ limit: 200 }));
  });

  it("fuera de horario responde ok sin tocar la base", async () => {
    vi.mocked(inSendingWindow).mockReturnValue(false);
    const res = await post({ authorization: "Bearer s3cret" });
    expect(await res.json()).toEqual({ ok: true, skippedWindow: true });
    expect(runSequences).not.toHaveBeenCalled();
  });
});
