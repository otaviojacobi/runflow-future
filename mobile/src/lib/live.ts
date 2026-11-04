/**
 * Conversations that stay current without a live channel (the contract has none), like the web's lib/live.ts: an
 * open workout thread is refetched every 10 s while its screen is focused and the app is in front (TanStack Query
 * pauses intervals in the background; the screens pass `useIsFocused()`), and again on returning to the app.
 * Founder, 2026-11-04: a trainer's reply never appeared on the student's open workout until she left and came back.
 */
import type { NativeScrollEvent } from "react-native";

export const THREAD_POLL_MS = 10_000;

/** Query options for a conversation on screen; `live` = its screen is focused. */
export const liveQuery = (live: boolean, ms: number = THREAD_POLL_MS) =>
  ({ refetchInterval: live ? ms : false, refetchIntervalInBackground: false, refetchOnWindowFocus: "always" }) as const;

/**
 * Whether a thread should scroll to its newest message after an update: when the person sent it, or when they were
 * already at the end. Someone reading older messages isn't pulled away. Unlike the web, opening a workout doesn't
 * jump to its conversation (it sits at the bottom of the workout).
 */
export function followNewest({ before, after, atEnd, lastIsMine }: { before: number | undefined; after: number; atEnd: boolean; lastIsMine: boolean }): boolean {
  if (after === 0 || before === undefined || after <= before) return false;
  return atEnd || lastIsMine;
}

/** A scroll position within `slack` points of the end. */
export const isAtEnd = ({ contentOffset, layoutMeasurement, contentSize }: NativeScrollEvent, slack = 48) =>
  contentOffset.y + layoutMeasurement.height >= contentSize.height - slack;
