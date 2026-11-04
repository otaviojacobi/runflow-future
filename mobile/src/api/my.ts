/**
 * The student's side (`/clubs/{club_id}/my/*`, M1 Hoje, M2 Treino, M3 Agenda, M5 feedback) and the workout threads,
 * like the web's src/api/my.ts. Types mirror api/endpoints.md (snake_case, as on the wire).
 *
 * Offline (root.md §2, §7.5): the queries that carry this week (calendar, summary, workout details, threads) save
 * their last answer on the device and start from it, so the week opens instantly and without a connection.
 */
import { useMutation, useQuery, type QueryKey } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { addDays } from "@/lib/format";
import { liveQuery } from "@/lib/live";
import { offline, savedData } from "@/lib/offline";
import { queryClient } from "@/queryClient";
import { actKey } from "./activities";
import { meKey } from "./me";
import type { Activity, Comment, CompletionStatus, Feeling, ID, ISODate, ISOTime, NextClass, PlannedWorkout, User } from "./types";

// ---------- responses (the shared rows live in types.ts)
/** GET /my/workouts/{id}: zone targets carry `resolved` ranges from the student's zones. */
export interface MyWorkoutDetail extends PlannedWorkout { activity: Activity | null; candidate_activities: Activity[]; coach: User | null }
/** A future week the trainer hasn't released to the student yet (D-031). */
export interface UnreleasedWeek { week_start: ISODate; auto_release_at: ISOTime | null }
export interface MyCalendar { items: PlannedWorkout[]; unreleased_weeks: UnreleasedWeek[] }
export interface MySummary {
  shares_data: boolean; streak_weeks: number; week: { planned: number; done: number; duration_s: number; distance_m: number };
  last_activity: Activity | null;
  /** The next booked or waitlisted class (Aulas, D-052); null without one, absent on older APIs. */
  next_class?: NextClass | null;
}
export interface CompletionInput { status: CompletionStatus; rpe: number | null; feeling: Feeling | null; comment: string; activity_id?: ID | null }

// ---------- keys
export const myKey = (clubId: string) => ["clubs", clubId, "my"] as const;
export const calendarKey = (clubId: string, from: ISODate, to: ISODate) => [...myKey(clubId), "workouts", from, to] as const;
export const workoutKey = (clubId: string, id: ID) => [...myKey(clubId), "workout", id] as const;
export const summaryKey = (clubId: string) => [...myKey(clubId), "summary"] as const;
export const threadKey = (clubId: string, id: ID) => ["clubs", clubId, "thread", id] as const;

/**
 * Fetches and saves the answer for offline use. `day` is the date it is about (the device keeps only the weeks around
 * this one), `null` for undated data (the summary), `undefined` to skip saving.
 */
const saved = <T,>(key: QueryKey, day: (d: T) => ISODate | null | undefined, fetch: () => Promise<T>) => () =>
  fetch().then((d) => { const on = day(d); if (on !== undefined) offline.put(key, d, on); return d; });

// ---------- queries
const fetchCalendar = (clubId: string, from: ISODate, to: ISODate) => {
  const key = calendarKey(clubId, from, to);
  return saved(key, () => from, () => api.get<MyCalendar>(`/clubs/${clubId}/my/workouts?from=${from}&to=${to}`));
};
/**
 * A range already on the device that covers [from, to] (Hoje's two weeks hold the Agenda's week; the month holds its
 * weeks), cut to the range: the screen starts from it, online or offline, then revalidates.
 */
function covering(clubId: string, from: ISODate, to: ISODate): { data: MyCalendar; at: number } | undefined {
  const prefix = [...myKey(clubId), "workouts"];
  const loaded = queryClient.getQueryCache().findAll({ queryKey: prefix }).filter((q) => q.state.data !== undefined)
    .map((q) => ({ key: q.queryKey, data: q.state.data as MyCalendar, at: q.state.dataUpdatedAt }));
  const best = [...loaded, ...offline.list<MyCalendar>(prefix)]
    .filter(({ key }) => (key[4] as string) <= from && (key[5] as string) >= to)
    .sort((a, b) => b.at - a.at)[0];
  if (!best) return undefined;
  return {
    at: best.at,
    data: { items: best.data.items.filter((w) => w.date >= from && w.date <= to), unreleased_weeks: best.data.unreleased_weeks.filter((u) => u.week_start <= to && addDays(u.week_start, 6) >= from) },
  };
}
/** Own released workouts in [from, to] + the weeks in it still in preparation (one request). */
export function useMyCalendar(clubId: string | undefined, from: ISODate, to: ISODate) {
  const key = calendarKey(clubId ?? "", from, to);
  const start = () => offline.get<MyCalendar>(key) ?? (clubId ? covering(clubId, from, to) : undefined);
  return useQuery({ queryKey: key, enabled: !!clubId, queryFn: fetchCalendar(clubId ?? "", from, to), initialData: () => start()?.data, initialDataUpdatedAt: () => start()?.at });
}
/** Loads a range ahead of time (the weeks around the one on screen), so moving between them is instant. */
export const prefetchCalendar = (clubId: string, from: ISODate, to: ISODate) =>
  queryClient.prefetchQuery({ queryKey: calendarKey(clubId, from, to), queryFn: fetchCalendar(clubId, from, to), staleTime: 60_000 });

const fetchWorkout = (clubId: string, id: ID) =>
  saved<MyWorkoutDetail>(workoutKey(clubId, id), (w) => w.date, () => api.get<MyWorkoutDetail>(`/clubs/${clubId}/my/workouts/${id}`));
/** The calendar row for a workout, from any loaded range: the detail screen shows it while the detail loads. */
function listed(clubId: string, id: ID): MyWorkoutDetail | undefined {
  for (const [, cal] of queryClient.getQueriesData<MyCalendar>({ queryKey: [...myKey(clubId), "workouts"] })) {
    const w = cal?.items.find((x) => x.id === id);
    if (w) return { ...w, activity: null, candidate_activities: [], coach: null };
  }
  return undefined;
}
export function useMyWorkout(clubId: string | undefined, id: ID) {
  const key = workoutKey(clubId ?? "", id);
  return useQuery({
    queryKey: key, enabled: !!clubId && !!id, queryFn: fetchWorkout(clubId ?? "", id), ...savedData<MyWorkoutDetail>(key),
    placeholderData: () => (clubId ? listed(clubId, id) : undefined),
  });
}
/** This week's workouts with personal targets, ahead of time: opening one works offline too. No side effects. */
export function prefetchWorkouts(clubId: string, ids: ID[]) {
  for (const id of ids) {
    const key = workoutKey(clubId, id);
    // Starts from the saved copy too: a prefetch that fails offline must not leave an empty query in its place.
    void queryClient.prefetchQuery({ queryKey: key, queryFn: fetchWorkout(clubId, id), staleTime: 5 * 60_000, ...savedData<MyWorkoutDetail>(key) });
  }
}

export function useMySummary(clubId: string | undefined) {
  const key = summaryKey(clubId ?? "");
  return useQuery({ queryKey: key, enabled: !!clubId, queryFn: saved(key, () => null, () => api.get<MySummary>(`/clubs/${clubId}/my/summary`)), ...savedData<MySummary>(key) });
}

/** Applies a changed row to every loaded range and to the detail (whose targets stay the resolved ones). */
function patchWorkout(clubId: string, id: ID, patch: Partial<PlannedWorkout>) {
  queryClient.setQueriesData<MyCalendar>({ queryKey: [...myKey(clubId), "workouts"] }, (cal) =>
    cal && cal.items.some((w) => w.id === id) ? { ...cal, items: cal.items.map((w) => (w.id === id ? { ...w, ...patch } : w)) } : cal);
  queryClient.setQueryData<MyWorkoutDetail>(workoutKey(clubId, id), (w) => (w ? { ...w, ...patch } : w));
}

/** M5: did it, effort (PSE), feeling, comment, the activity. The trainer is notified. */
export const useSaveCompletion = (clubId: string) =>
  useMutation({
    mutationFn: ({ id, ...v }: CompletionInput & { id: ID }) => api.put<PlannedWorkout>(`/clubs/${clubId}/my/workouts/${id}/completion`, v),
    onSuccess: (w) => {
      patchWorkout(clubId, w.id, { completion: w.completion, comments_count: w.comments_count, unread_count: w.unread_count, updated_at: w.updated_at });
      // The summary (week, streak) and the matched activity change on the server, and so may the activity's own
      // match (D-049: a question answered by picking it here).
      void queryClient.invalidateQueries({ queryKey: myKey(clubId) });
      void queryClient.invalidateQueries({ queryKey: actKey });
    },
  });

// ---------- thread (student ⇄ trainers)
/**
 * GET marks the thread as read, so the workout's unread count goes to zero everywhere. While its screen is focused
 * (`live`) it is refetched every 10 s (lib/live), so a reply shows up without leaving the screen; when something new
 * arrives the bell is refreshed too.
 */
export function useComments(clubId: string | undefined, id: ID, day: ISODate | undefined, live = true) {
  const key = threadKey(clubId ?? "", id);
  return useQuery({
    queryKey: key, enabled: !!clubId && !!id, ...savedData<Comment[]>(key), ...liveQuery(live),
    queryFn: saved(key, () => day, () => api.get<{ items: Comment[] }>(`/clubs/${clubId}/planned-workouts/${id}/comments`).then((r) => {
      const before = queryClient.getQueryData<Comment[]>(key);
      if (before && r.items.length > before.length) void queryClient.invalidateQueries({ queryKey: meKey });
      if (clubId) patchWorkout(clubId, id, { unread_count: 0, comments_count: r.items.length });
      return r.items;
    })),
  });
}
export const usePostComment = (clubId: string, id: ID) =>
  useMutation({
    mutationFn: (body: string) => api.post<Comment>(`/clubs/${clubId}/planned-workouts/${id}/comments`, { body }),
    onSuccess: (c) => {
      queryClient.setQueryData<Comment[]>(threadKey(clubId, id), (list) => (list ? [...list, c] : [c]));
      void queryClient.invalidateQueries({ queryKey: threadKey(clubId, id) });
    },
  });
