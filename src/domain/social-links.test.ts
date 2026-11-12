import { describe, expect, it } from "vitest";
import { CODE_RE } from "./community-posts";
import { newSocialCode, SOCIAL_CODE_RE, socialUtm } from "./social-links";

describe("ligas de redes", () => {
  it("código de 7: nunca choca con el de un post (6)", () => {
    const c = newSocialCode();
    expect(SOCIAL_CODE_RE.test(c)).toBe(true);
    expect(CODE_RE.test(c)).toBe(true);
    expect(c).toHaveLength(7);
  });

  it("socialUtm: la campaña sale del tipo del lead y del tipo de liga; el usuario nunca viaja", () => {
    expect(socialUtm({ code: "k7m2qxa", kind: "invitacion" }, { platform: "instagram", leadType: "influencer" })).toEqual(
      { utm_source: "instagram", utm_medium: "redes", utm_campaign: "redes-influencer-202611", utm_content: "invitacion", utm_term: "k7m2qxa" });
    expect(socialUtm({ code: "k7m2qxa", kind: "invitacion" }, { platform: "tiktok", leadType: "psicologo" }).utm_campaign).toBe("redes-psicologo-202611");
    expect(socialUtm({ code: "k7m2qxb", kind: "promocion" }, { platform: "tiktok", leadType: "influencer" })).toMatchObject({ utm_source: "tiktok", utm_campaign: "redes-promo-202611", utm_content: "promo" });
    expect(socialUtm({ code: "k7m2qxa", kind: "invitacion" }, { platform: null, leadType: null })).toMatchObject({ utm_source: "redes", utm_campaign: "redes-psicologo-202611" });
  });
});
