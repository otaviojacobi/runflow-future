/** Join class names, skipping falsy values. */
export const cn = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
