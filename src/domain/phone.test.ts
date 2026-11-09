import { describe, expect, it } from "vitest";
import { normalizePhoneE164, waMessageLink } from "./phone";

describe("normalizePhoneE164", () => {
  it.each([
    ["+52 55 1234 5678", "525512345678"],
    ["5512345678", "525512345678"],
    ["(55) 1234-5678", "525512345678"],
    ["52 1 55 1234 5678", "5215512345678"],
    ["+1 332 600 3103", "13326003103"],
    ["525512345678", "525512345678"],
  ])("%s → %s", (raw, e164) => expect(normalizePhoneE164(raw)).toBe(e164));

  it.each([["123"], [""], [null], [undefined], ["+52 55 1234"], ["5255123456789999"]])("%s → null", (raw) =>
    expect(normalizePhoneE164(raw as string | null | undefined)).toBeNull(),
  );
});

describe("waMessageLink", () => {
  it("con teléfono lleva destinatario; sin teléfono abre el selector de contacto", () => {
    expect(waMessageLink("525512345678", "Hola Ana")).toBe("https://wa.me/525512345678?text=Hola%20Ana");
    expect(waMessageLink(null, "Hola")).toBe("https://wa.me/?text=Hola");
  });
});
