import { describe, expect, it } from "vitest";
import { referralCodeFrom, referralLinkWithUtm } from "./sellers";

describe("referralCodeFrom", () => {
  it("saca el código del último segmento de la liga /r/<código>", () => {
    expect(referralCodeFrom("https://ziora-copilot.com/r/CHRIST-ERWK")).toBe("CHRIST-ERWK");
    expect(referralCodeFrom("https://ziora-copilot.com/r/christ-erwk/")).toBe("CHRIST-ERWK");
  });
  it("null si no hay liga o no tiene /r/", () => {
    expect(referralCodeFrom(null)).toBeNull();
    expect(referralCodeFrom("https://ziora-copilot.com/")).toBeNull();
    expect(referralCodeFrom("no es una url")).toBeNull();
  });
});

describe("referralLinkWithUtm", () => {
  it("agrega los UTM de Ops conservando la liga", () => {
    const url = referralLinkWithUtm("https://ziora-copilot.com/r/CHRIST-ERWK", { campaign: "mtw-2026", code: "CHRIST-ERWK" });
    expect(url).toBe("https://ziora-copilot.com/r/CHRIST-ERWK?utm_source=ziora_ops&utm_medium=vendedor&utm_campaign=mtw-2026&utm_content=CHRIST-ERWK");
  });
  it("sin código omite utm_content y respeta una query previa", () => {
    expect(referralLinkWithUtm("https://ziora-copilot.com/?x=1", { campaign: "leads", code: null }))
      .toBe("https://ziora-copilot.com/?x=1&utm_source=ziora_ops&utm_medium=vendedor&utm_campaign=leads");
  });
});
