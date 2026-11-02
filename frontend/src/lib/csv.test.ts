import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("uses ; and decimal comma, quotes when needed, starts with a BOM", () => {
    const out = toCsv(["Aluno", "Km"], [["Ana Souza", 42.5], ['Bruno "Bru"; Lima', 10], ["Carla", null]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out.slice(1).split("\r\n")).toEqual(["Aluno;Km", "Ana Souza;42,5", '"Bruno ""Bru""; Lima";10', "Carla;"]);
  });
});
