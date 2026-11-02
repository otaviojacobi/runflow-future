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

/** Parse CSV pasted from Excel/Sheets: auto-detects ";" / "," / tab, handles quotes; strips a BOM. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = [";", "\t", ","].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
