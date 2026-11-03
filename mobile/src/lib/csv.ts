/**
 * CSV for Brazilian spreadsheets (the web's lib/csv.ts): ";" separator, decimal comma, CRLF, UTF-8 BOM so Excel opens
 * accents right. On the phone the file goes through the share sheet (lib/files.ts).
 */
import { shareTextFile } from "./files";

export type Cell = string | number | null | undefined;
const cell = (v: Cell) => {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v).replace(".", ",")) : v;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: Cell[][]) => "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
/** Resolves false when this device can't share files. */
export const shareCsv = (filename: string, header: string[], rows: Cell[][], dialogTitle: string) =>
  shareTextFile(filename, toCsv(header, rows), "text/csv", dialogTitle);
