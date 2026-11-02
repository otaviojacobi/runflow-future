import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("skips falsy values", () => expect(cn("a", false, null, undefined, "b")).toBe("a b"));
  it("lets later utilities override earlier ones in the same group", () => {
    expect(cn("w-full h-10 px-3", "w-24")).toBe("h-10 px-3 w-24");
    expect(cn("rounded-lg border border-line bg-surface", "bg-brand-soft border-brand-line")).toBe("rounded-lg border bg-brand-soft border-brand-line");
    expect(cn("text-base text-fg", "text-sm text-danger-text")).toBe("text-sm text-danger-text");
    expect(cn("rounded-md", "rounded-[8px]")).toBe("rounded-[8px]");
  });
  it("keeps different variants, sides and non-conflicting utilities", () => {
    expect(cn("w-full sm:w-72")).toBe("w-full sm:w-72");
    expect(cn("rounded-md rounded-r-none")).toBe("rounded-md rounded-r-none");
    expect(cn("border border-t border-line")).toBe("border border-t border-line");
    expect(cn("text-center text-fg text-[11px]")).toBe("text-center text-fg text-[11px]");
    expect(cn("bg-cover bg-surface")).toBe("bg-cover bg-surface");
    expect(cn("flex", "hidden lg:flex")).toBe("hidden lg:flex");
    expect(cn("hover:bg-soft bg-surface")).toBe("hover:bg-soft bg-surface");
    expect(cn("bg-[url(x:y)] [&_svg]:size-4 size-6")).toBe("bg-[url(x:y)] [&_svg]:size-4 size-6");
    expect(cn("gap-x-2 gap-y-1 inset-x-0 inset-y-0")).toBe("gap-x-2 gap-y-1 inset-x-0 inset-y-0");
  });
});
