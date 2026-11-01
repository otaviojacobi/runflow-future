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
});
