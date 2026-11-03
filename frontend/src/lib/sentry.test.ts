import { describe, expect, it } from "vitest";
import type { ErrorEvent } from "@sentry/react";
import { maskUrl, scrubBreadcrumb, scrubEvent } from "./sentry";

describe("sentry scrubbing (S12)", () => {
  it("masks token-like path segments and drops the query", () => {
    expect(maskUrl("https://qa.runflow.club/invite/Zm9vYmFyYmF6cXV4cXV1eDEyMzQ1?email=ana@email.com")).toBe("https://qa.runflow.club/invite/[token]");
    expect(maskUrl("/download/abcdefghijklmnopqrstuvwxyz012345.csv")).toBe("/download/[token]");
    expect(maskUrl("/api/v1/clubs/0195f3a0-1111-7000-8000-000000000000/races")).toBe("/api/v1/clubs/0195f3a0-1111-7000-8000-000000000000/races");
  });
  it("keeps the user id and the method only", () => {
    const e = scrubEvent({
      type: undefined,
      request: { url: "https://qa.runflow.club/today?x=1", method: "GET", headers: { Cookie: "rf_session=secret" }, query_string: "x=1" },
      user: { id: "u-1", email: "ana@email.com", ip_address: "1.2.3.4" },
    } as ErrorEvent);
    expect(e.request).toEqual({ url: "https://qa.runflow.club/today", method: "GET" });
    expect(e.user).toEqual({ id: "u-1" });
  });
  it("masks breadcrumb URLs", () => {
    const b = scrubBreadcrumb({ category: "fetch", data: { url: "/api/v1/invites/Zm9vYmFyYmF6cXV4cXV1eDEyMzQ1/accept?x=1", method: "POST" } });
    expect(b.data).toEqual({ url: "/api/v1/invites/[token]/accept", method: "POST" });
  });
});
