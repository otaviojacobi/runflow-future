/**
 * Workout hashtags (#intervalado, #limiar). Same rule as the API (api/endpoints.md § Tags):
 * lowercase, no "#", spaces become "-", only letters/digits/"-"/"_" (accents kept), ≤ 30 chars, ≤ 8 per workout.
 */
export const MAX_TAGS = 8;
export const MAX_TAG_LENGTH = 30;

export function normalizeTag(raw: string): string {
  return raw
    .replace(/^#+/, "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TAG_LENGTH);
}

/** Normalized, de-duplicated, capped list (order kept). */
export function cleanTags(tags: Iterable<string>): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const n = normalizeTag(t);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.slice(0, MAX_TAGS);
}

const HASHTAG = /(^|[\s(])#([\p{L}\p{N}_-]+)/gu;

/** Pull "#tags" out of free text (quick text, import lines). Returns the text without them. */
export function extractTags(text: string): { text: string; tags: string[] } {
  const found: string[] = [];
  const rest = text.replace(HASHTAG, (_m, lead: string, tag: string) => { found.push(tag); return lead; });
  return { text: rest.replace(/[ \t]{2,}/g, " ").replace(/\s*\+\s*$/, "").trim(), tags: cleanTags(found) };
}

/** Search needle for tags: "#Limiar" and "limiar" both match "limiar". */
export const tagNeedle = (q: string) => q.trim().replace(/^#+/, "").toLocaleLowerCase("pt-BR");
