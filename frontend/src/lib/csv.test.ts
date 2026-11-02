import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("toCsv", () => {
  it("uses ; and decimal comma, quotes when needed, starts with a BOM", () => {
    const out = toCsv(["Aluno", "Km"], [["Ana Souza", 42.5], ['Bruno "Bru"; Lima', 10], ["Carla", null]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out.slice(1).split("\r\n")).toEqual(["Aluno;Km", "Ana Souza;42,5", '"Bruno ""Bru""; Lima";10', "Carla;"]);
  });
});

describe("parseCsv", () => {
  it("detects ; and , and handles quotes and blank lines", () => {
    expect(parseCsv("\uFEFFnome;email\r\nAna Souza;ana@x.com\r\n\r\n")).toEqual([["nome", "email"], ["Ana Souza", "ana@x.com"]]);
    expect(parseCsv('nome,email,grupos\n"Lima, Bruno",b@x.com,"Iniciantes, Força"')).toEqual([["nome", "email", "grupos"], ["Lima, Bruno", "b@x.com", "Iniciantes, Força"]]);
  });
  it("round-trips its own export", () => {
    expect(parseCsv(toCsv(["a", "b"], [['x"y', "1;2"]]))).toEqual([["a", "b"], ['x"y', "1;2"]]);
  });
});
