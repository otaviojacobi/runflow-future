import { describe, expect, it } from "vitest";
import { cleanTags, extractTags, normalizeTag, tagNeedle } from "./tags";

describe("tags", () => {
  it("normalizes like the API", () => {
    expect(normalizeTag("#Intervalado")).toBe("intervalado");
    expect(normalizeTag("  Ritmo de Prova ")).toBe("ritmo-de-prova");
    expect(normalizeTag("#técnica!")).toBe("técnica");
    expect(normalizeTag("###")).toBe("");
    expect(normalizeTag("a".repeat(40))).toHaveLength(30);
  });
  it("dedupes and caps at 8", () => {
    expect(cleanTags(["Limiar", "#limiar", "pista", ""])).toEqual(["limiar", "pista"]);
    expect(cleanTags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(8);
  });
  it("extracts hashtags from quick text", () => {
    expect(extractTags("10' aquec + 6x1km @4:30 c/ 2' trote #intervalado #Pista")).toEqual({ text: "10' aquec + 6x1km @4:30 c/ 2' trote", tags: ["intervalado", "pista"] });
    expect(extractTags("#longão 1h40 Z2")).toEqual({ text: "1h40 Z2", tags: ["longão"] });
    expect(extractTags("8x400m @1:35 c/ 90\" parado").tags).toEqual([]);
  });
  it("search needle ignores # and case", () => expect(tagNeedle(" #Limiar")).toBe("limiar"));
});
