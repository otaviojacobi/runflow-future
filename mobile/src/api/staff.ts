/**
 * Staff (trainer and owner) data, X8: dashboard (W1), athletes and groups (W2, W3), planned workouts, assigning from
 * the library and week release (W4), feedback inbox and threads (W8). Same endpoints, keys and shapes as the web's
 * api/{dashboard,members,activities,workouts,library,feedback}.ts; the wire types live in types.ts (api/endpoints.md).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { liveQuery } from "@/lib/live";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { Structure } from "@/domain/workout";
import type {
  AthleteDetail, AthleteProfile, AthleteSummary, Comment, Dashboard, FeedbackFilter, FeedbackItem, Group, PlannedWorkout, PlannedWorkoutDetail,
  Sport, WeekState, WorkoutTemplate, Zone,
} from "./types";

export type TrendPoint = Dashboard["compliance_trend"][number];
export type DashboardAlert = Dashboard["alerts"][number];
/** POST /planned-workouts: a library template or a workout built on the spot, for students on one or more days. */
export type AssignInput = { athlete_ids: string[]; group_id?: string; dates: string[]; notes?: string | null } & (
  | { template_id: string }
  | { sport: Sport; title: string; structure: Structure; est_duration_s: number | null; est_distance_m: number | null }
);
export type ZonesInput = { kind: "pace"; threshold_pace_s_per_km?: number; race?: { distance_m: number; time_s: number } } | { kind: "hr"; max_hr: number };

// ---------- keys and helpers
const qs = (p: Record<string, string | number | undefined | null>) => {
  const s = Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  return s ? `?${s}` : "";
};
export const staffKeys = {
  club: (c: string) => ["clubs", c] as const,
  dashboard: (c: string) => ["clubs", c, "dashboard"] as const,
  athletes: (c: string) => ["clubs", c, "athletes"] as const,
  athlete: (c: string, id: string) => ["clubs", c, "athlete", id] as const,
  groups: (c: string) => ["clubs", c, "groups"] as const,
  planned: (c: string) => ["clubs", c, "planned"] as const,
  feedback: (c: string) => ["clubs", c, "feedback"] as const,
  templates: (c: string) => ["clubs", c, "templates"] as const,
  thread: (c: string, id: string) => ["clubs", c, "thread", id] as const,
};
/** A change to the plan shows on every staff screen (Painel, Alunos, the student, Planejamento, Feedbacks). */
const refreshClub = (c: string) => queryClient.invalidateQueries({ queryKey: staffKeys.club(c) });
/** Reading a thread changes the unread counts the inbox, the Painel and the planning rows show. */
const refreshUnread = (c: string) => {
  // `/me` too: a reply can clear the Feedbacks count (memberships[].unread.feedback).
  for (const k of [staffKeys.feedback(c), staffKeys.dashboard(c), staffKeys.planned(c), meKey]) void queryClient.invalidateQueries({ queryKey: k });
};

// ---------- W1 dashboard
export const useDashboard = (clubId: string | undefined) =>
  useQuery({ queryKey: staffKeys.dashboard(clubId ?? ""), enabled: !!clubId, refetchInterval: 60_000, queryFn: () => api.get<Dashboard>(`/clubs/${clubId}/dashboard`) });

// ---------- W2/W3 athletes and groups
export const useGroups = (clubId: string | undefined) =>
  useQuery({ queryKey: staffKeys.groups(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<{ items: Group[] }>(`/clubs/${clubId}/groups`).then((r) => r.items) });
export const useAthletes = (clubId: string | undefined, f: { q?: string; group_id?: string } = {}) =>
  useQuery({
    queryKey: [...staffKeys.athletes(clubId ?? ""), f], enabled: !!clubId, placeholderData: (p) => p,
    queryFn: () => api.get<{ items: AthleteSummary[] }>(`/clubs/${clubId}/athletes${qs({ ...f, limit: 500 })}`).then((r) => r.items),
  });
export const useAthlete = (clubId: string | undefined, id: string) =>
  useQuery({ queryKey: staffKeys.athlete(clubId ?? "", id), enabled: !!clubId && !!id, queryFn: () => api.get<AthleteDetail>(`/clubs/${clubId}/athletes/${id}`) });
/** PUT …/profile takes only the fields sent (goal, level, physiology, the private trainer notes). */
export const useSaveAthleteProfile = (clubId: string, id: string) =>
  useMutation({
    mutationFn: (v: Partial<AthleteProfile>) => api.put<AthleteProfile>(`/clubs/${clubId}/athletes/${id}/profile`, v),
    onSuccess: () => refreshClub(clubId),
  });
/** Recalculate zones from a threshold pace, a race or the max heart rate; the student's targets follow. */
export const useSetZones = (clubId: string, id: string) =>
  useMutation({ mutationFn: (v: ZonesInput) => api.put<Zone>(`/clubs/${clubId}/athletes/${id}/zones`, v), onSuccess: () => refreshClub(clubId) });
/** Create or rename a group, then set its members (PUT …/members replaces the list). */
export const useSaveGroup = (clubId: string) =>
  useMutation({
    mutationFn: async (v: { id?: string; name: string; member_ids?: string[] }) => {
      const g = v.id ? await api.patch<Group>(`/clubs/${clubId}/groups/${v.id}`, { name: v.name }) : await api.post<Group>(`/clubs/${clubId}/groups`, { name: v.name });
      return v.member_ids ? api.put<Group>(`/clubs/${clubId}/groups/${g.id}/members`, { membership_ids: v.member_ids }) : g;
    },
    onSuccess: () => refreshClub(clubId),
  });
export const useDeleteGroup = (clubId: string) =>
  useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/groups/${id}`), onSuccess: () => refreshClub(clubId) });

// ---------- W6 library: api/library.ts (the same key, so staff lists refresh with it)
export { useTemplates } from "./library";

// ---------- W4 planned workouts and week release
export const usePlanned = (clubId: string | undefined, f: { from: string; to: string; athlete_id?: string; group_id?: string }) =>
  useQuery({
    queryKey: [...staffKeys.planned(clubId ?? ""), f], enabled: !!clubId, placeholderData: (p) => p,
    queryFn: () => api.get<{ items: PlannedWorkout[] }>(`/clubs/${clubId}/planned-workouts${qs(f)}`).then((r) => r.items),
  });
export const usePlannedDetail = (clubId: string | undefined, id: string | null) =>
  useQuery({ queryKey: [...staffKeys.planned(clubId ?? ""), "detail", id], enabled: !!clubId && !!id, queryFn: () => api.get<PlannedWorkoutDetail>(`/clubs/${clubId}/planned-workouts/${id}`) });
/** Assign (bulk): one workout per student × day. Drafts (D-031) wait for their week's release. */
export const useAssign = (clubId: string) =>
  useMutation({ mutationFn: (v: AssignInput) => api.post<{ items: PlannedWorkout[] }>(`/clubs/${clubId}/planned-workouts`, v), onSuccess: () => refreshClub(clubId) });
/** Copy a week onto another (every student, or some). */
export const useCopyWeek = (clubId: string) =>
  useMutation({
    mutationFn: (v: { from_monday: string; to_monday: string; athlete_ids?: string[] }) => api.post<{ copied: number }>(`/clubs/${clubId}/planned-workouts/copy-week`, v),
    onSuccess: () => refreshClub(clubId),
  });
export const useUpdatePlanned = (clubId: string) =>
  useMutation({
    mutationFn: ({ id, ...v }: { id: string } & Partial<Pick<PlannedWorkout, "date" | "title" | "notes" | "structure" | "est_duration_s" | "est_distance_m">>) => api.patch<PlannedWorkout>(`/clubs/${clubId}/planned-workouts/${id}`, v),
    onSuccess: () => refreshClub(clubId),
  });
export const useDeletePlanned = (clubId: string) =>
  useMutation({
    mutationFn: (id: string) => api.del(`/clubs/${clubId}/planned-workouts/${id}`),
    // Everything but the removed workout's own detail and thread (they would only answer 404 now).
    onSuccess: (_, id) => queryClient.invalidateQueries({ queryKey: staffKeys.club(clubId), predicate: (q) => !q.queryKey.includes(id) }),
  });
export const useWeek = (clubId: string | undefined, monday: string, enabled = true) =>
  useQuery({ queryKey: [...staffKeys.planned(clubId ?? ""), "week", monday], enabled: !!clubId && enabled, queryFn: () => api.get<WeekState>(`/clubs/${clubId}/weeks/${monday}`) });
export const useReleaseWeek = (clubId: string) =>
  useMutation({
    mutationFn: ({ monday, ...v }: { monday: string; group_id?: string; notify: boolean }) => api.post<WeekState>(`/clubs/${clubId}/weeks/${monday}/release`, v),
    onSuccess: () => refreshClub(clubId),
  });
export const useUndoRelease = (clubId: string) =>
  useMutation({ mutationFn: (monday: string) => api.del<WeekState>(`/clubs/${clubId}/weeks/${monday}/release`), onSuccess: () => refreshClub(clubId) });

// ---------- W8 feedback inbox and threads
export const useFeedback = (clubId: string | undefined, filter: FeedbackFilter) =>
  useQuery({
    queryKey: [...staffKeys.feedback(clubId ?? ""), filter], enabled: !!clubId, placeholderData: (p) => p, refetchInterval: 30_000,
    queryFn: () => api.get<{ items: FeedbackItem[]; counts: Record<FeedbackFilter, number> }>(`/clubs/${clubId}/feedback?filter=${filter}`),
  });
/** POST /feedback/read: these threads (or all of them, without ids) as read. */
export const useMarkRead = (clubId: string) =>
  useMutation({ mutationFn: (workout_ids?: string[]) => api.post(`/clubs/${clubId}/feedback/read`, workout_ids ? { workout_ids } : {}), onSuccess: () => refreshUnread(clubId) });
/**
 * The thread on a planned workout. GET marks it as read, so the unread counts elsewhere refresh after it. While it is
 * open on a focused screen (`live`) it is refetched every 10 s (lib/live): a student's new message shows up by itself.
 */
export const useComments = (clubId: string | undefined, id: string | null, live = true) =>
  useQuery({
    queryKey: staffKeys.thread(clubId ?? "", id ?? ""), enabled: !!clubId && !!id, ...liveQuery(live),
    queryFn: async () => {
      const r = await api.get<{ items: Comment[] }>(`/clubs/${clubId}/planned-workouts/${id}/comments`);
      // The first read and anything new change the counts; a poll with nothing new doesn't.
      const before = queryClient.getQueryData<Comment[]>(staffKeys.thread(clubId!, id!));
      if (!before || r.items.length !== before.length) refreshUnread(clubId!);
      return r.items;
    },
  });
export const usePostComment = (clubId: string, id: string) =>
  useMutation({
    mutationFn: (body: string) => api.post<Comment>(`/clubs/${clubId}/planned-workouts/${id}/comments`, { body }),
    onSuccess: (c) => {
      queryClient.setQueryData<Comment[]>(staffKeys.thread(clubId, id), (prev) => (prev && !prev.some((x) => x.id === c.id) ? [...prev, c] : prev));
      refreshUnread(clubId);
      void queryClient.invalidateQueries({ queryKey: staffKeys.athletes(clubId) });
    },
  });
