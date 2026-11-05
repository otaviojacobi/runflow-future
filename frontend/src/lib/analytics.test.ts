import { describe, expect, it } from "vitest";
import { analyticsReferrer, analyticsUrl } from "./analytics";

describe("analytics URLs (D-054)", () => {
  it("keeps campaign parameters and drops everything else", () => {
    expect(analyticsUrl("https://qa.runflow.club/?utm_source=instagram&utm_campaign=lancamento&email=ana%40x.com"))
      .toBe("/?utm_source=instagram&utm_campaign=lancamento");
    expect(analyticsUrl("https://qa.runflow.club/login?perfil=treinador&email=ana%40x.com")).toBe("/login?perfil=treinador");
    expect(analyticsUrl("https://qa.runflow.club/?ref=assessoria-x")).toBe("/?ref=assessoria-x");
  });

  it("masks token-like path segments (invite links) but keeps ids and words", () => {
    expect(analyticsUrl("https://qa.runflow.club/invite/Xk3_9fQpL2mZr8TvY1wq7Bn")).toBe("/invite/[token]");
    expect(analyticsUrl("/students/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b")).toBe("/students/0193a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b");
    expect(analyticsUrl("/club/members#convites")).toBe("/club/members");
  });

  it("keeps other sites as referrers and masks our own pages", () => {
    const origin = "https://qa.runflow.club";
    expect(analyticsReferrer("https://l.instagram.com/?u=abc", origin)).toBe("https://l.instagram.com/");
    expect(analyticsReferrer("https://qa.runflow.club/invite/Xk3_9fQpL2mZr8TvY1wq7Bn?x=1", origin)).toBe("https://qa.runflow.club/invite/[token]");
    expect(analyticsReferrer("", origin)).toBe("");
  });
});
