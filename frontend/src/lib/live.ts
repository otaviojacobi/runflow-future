/**
 * Conversations that stay current without a live channel (the contract has none): an open workout thread is refetched
 * every 10 s while the page is visible (TanStack Query pauses intervals in a hidden tab) and again whenever the tab
 * comes back. Founder, 2026-11-04: a trainer's reply never appeared on the student's open workout until she left
 * and came back. The app mirrors this (mobile/src/lib/live.ts).
 */
export const THREAD_POLL_MS = 10_000;

/** Query options for a conversation on screen. */
export const liveQuery = (ms: number = THREAD_POLL_MS) =>
  ({ refetchInterval: ms, refetchIntervalInBackground: false, refetchOnWindowFocus: "always" }) as const;

/**
 * Whether a thread should scroll to its newest message after an update: on the first load, when the person sent it,
 * or when they were already looking at the end. Someone reading older messages isn't pulled away.
 */
export function followNewest({ before, after, atEnd, lastIsMine }: { before: number | undefined; after: number; atEnd: boolean; lastIsMine: boolean }): boolean {
  if (after === 0) return false;
  if (before === undefined) return true;
  if (after <= before) return false;
  return atEnd || lastIsMine;
}
