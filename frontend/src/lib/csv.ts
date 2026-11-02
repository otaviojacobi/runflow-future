/** CSV for Brazilian spreadsheets: ";" separator, decimal comma, CRLF, UTF-8 BOM (so Excel opens accents right). */
export type Cell = string | number | null | undefined;
const cell = (v: Cell) => {
  if (v == null) return "";
  const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : String(v).replace(".", ",")) : v;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (header: string[], rows: Cell[][]) => "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
export function downloadCsv(filename: string, header: string[], rows: Cell[][]) {
  const url = URL.createObjectURL(new Blob([toCsv(header, rows)], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}
