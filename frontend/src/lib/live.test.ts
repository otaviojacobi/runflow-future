import { describe, expect, it } from "vitest";
import { THREAD_POLL_MS, followNewest, liveQuery } from "./live";

describe("live conversations", () => {
  it("poll an open thread every 10 s, never in a hidden tab, and again on focus", () => {
    // Regression (founder, 2026-11-04): an open conversation was fetched once, so a reply never showed up.
    expect(THREAD_POLL_MS).toBe(10_000);
    expect(liveQuery()).toEqual({ refetchInterval: 10_000, refetchIntervalInBackground: false, refetchOnWindowFocus: "always" });
  });

  it("follow the newest message only when it helps", () => {
    expect(followNewest({ before: undefined, after: 3, atEnd: false, lastIsMine: false })).toBe(true); // first load
    expect(followNewest({ before: undefined, after: 0, atEnd: true, lastIsMine: false })).toBe(false); // empty
    expect(followNewest({ before: 2, after: 3, atEnd: true, lastIsMine: false })).toBe(true); // a reply while at the end
    expect(followNewest({ before: 2, after: 3, atEnd: false, lastIsMine: false })).toBe(false); // reading older ones
    expect(followNewest({ before: 2, after: 3, atEnd: false, lastIsMine: true })).toBe(true); // one I just sent
    expect(followNewest({ before: 3, after: 3, atEnd: true, lastIsMine: false })).toBe(false); // a poll with nothing new
  });
});
