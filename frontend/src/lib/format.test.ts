import { describe, expect, it } from "vitest";
import { ago, clock, dayMonth, distance, duration, initials, isoWeekday, money, mondayOf, pace, shortDate } from "./format";

describe("format (pt-BR)", () => {
  it("formats paces and clocks", () => {
    expect(pace(270)).toBe("4:30");
    expect(pace(null)).toBe("–");
    expect(clock(6128)).toBe("1:42:08");
    expect(clock(545)).toBe("9:05");
  });
  it("formats durations and distances", () => {
    expect(duration(3540)).toBe("59 min");
    expect(duration(5100)).toBe("1h25");
    expect(duration(7200)).toBe("2h");
    expect(distance(10400)).toBe("10,4 km");
    expect(distance(400)).toBe("400 m");
    expect(distance(2000, { swim: true })).toBe("2.000 m");
  });
  it("formats dates and money", () => {
    expect(shortDate("2026-11-03")).toBe("ter, 3 nov");
    expect(dayMonth("2026-11-03")).toBe("3 nov");
    expect(isoWeekday("2026-11-02")).toBe(1);
    expect(mondayOf("2026-11-08")).toBe("2026-11-02");
    expect(money(2000)).toMatch(/R\$\s?20,00/);
    expect(initials("Ana Souza")).toBe("AS");
    expect(ago(new Date(Date.now() - 5 * 60000).toISOString())).toBe("há 5 min");
  });
  it("writes and reads dates in numbers as dd/mm/aaaa", async () => {
    const { brDate, brToIso, maskDate } = await import("./format");
    expect(brDate("2026-11-03")).toBe("03/11/2026");
    expect(brDate("2026-11-03T10:00:00Z")).toBe("03/11/2026");
    expect(maskDate("14091988")).toBe("14/09/1988");
    expect(maskDate("14/0")).toBe("14/0");
    expect(maskDate("1409198899")).toBe("14/09/1988");
    expect(brToIso("14/09/1988")).toBe("1988-09-14");
    expect(brToIso("31/02/2026")).toBeNull();
    expect(brToIso("14/09/88")).toBeNull();
    expect(brToIso("01/01/1850")).toBeNull();
  });
});

describe("money input", () => {
  it("parses pt-BR amounts to centavos", async () => {
    const { parseMoney, centsToInput } = await import("./format");
    expect(parseMoney("180")).toBe(18000);
    expect(parseMoney("180,50")).toBe(18050);
    expect(parseMoney("1.250,5")).toBe(125050);
    expect(parseMoney("0")).toBeNull();
    expect(parseMoney("abc")).toBeNull();
    expect(centsToInput(18050)).toBe("180,50");
  });
});
