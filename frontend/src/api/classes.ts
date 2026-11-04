/** Aulas (D-052; api/endpoints.md § Aulas): venues, class types, recurring schedules, sessions, bookings, check-in. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { myKey } from "./my";
import type { Booking, ClassSchedule, ClassSession, ClassSessionDetail, ClassType, Venue } from "./types";

const k = (clubId: string) => ["clubs", clubId, "classes"] as const;
/** Anything that changes seats or sessions also changes Hoje's next class, the dashboard and the attendance report. */
const refresh = (clubId: string) => {
  void queryClient.invalidateQueries({ queryKey: k(clubId) });
  void queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "dashboard"] });
  void queryClient.invalidateQueries({ queryKey: myKey(clubId) });
  void queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "reports"] });
};
const list = <T,>(path: string) => api.get<{ items: T[] }>(path).then((r) => r.items);

export const useVenues = (clubId: string | undefined) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "venues"], enabled: !!clubId, queryFn: () => list<Venue>(`/clubs/${clubId}/locations`) });
export type VenueInput = { id?: string; name: string; kind: Venue["kind"]; address: string | null; lanes: number | null };
export const useSaveVenue = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: VenueInput) => (id ? api.patch<Venue>(`/clubs/${clubId}/locations/${id}`, v) : api.post<Venue>(`/clubs/${clubId}/locations`, v)),
  onSuccess: () => refresh(clubId),
});
export const useArchiveVenue = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/locations/${id}`), onSuccess: () => refresh(clubId) });

export const useClassTypes = (clubId: string | undefined) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "types"], enabled: !!clubId, queryFn: () => list<ClassType>(`/clubs/${clubId}/class-types`) });
export type ClassTypeInput = { id?: string } & Pick<ClassType, "name" | "sport" | "description" | "default_capacity" | "duration_min">;
export const useSaveClassType = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: ClassTypeInput) => (id ? api.patch<ClassType>(`/clubs/${clubId}/class-types/${id}`, v) : api.post<ClassType>(`/clubs/${clubId}/class-types`, v)),
  onSuccess: () => refresh(clubId),
});
export const useArchiveClassType = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/class-types/${id}`), onSuccess: () => refresh(clubId) });

export interface NewSchedule { class_type_id: string; weekdays: number[]; start_time: string; duration_min?: number; capacity?: number; location_id?: string | null; instructor_membership_id?: string | null }
export const useSchedules = (clubId: string | undefined) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "schedules"], enabled: !!clubId, queryFn: () => list<ClassSchedule>(`/clubs/${clubId}/class-schedules`) });
export const useCreateSchedule = (clubId: string) =>
  useMutation({ mutationFn: (v: NewSchedule) => api.post<{ items: ClassSchedule[]; sessions: number }>(`/clubs/${clubId}/class-schedules`, v), onSuccess: () => refresh(clubId) });
export const useEndSchedule = (clubId: string) =>
  useMutation({ mutationFn: (id: string) => api.del<{ cancelled_sessions: number }>(`/clubs/${clubId}/class-schedules/${id}`), onSuccess: () => refresh(clubId) });

export const useSessions = (clubId: string | undefined, from: string, to: string) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "sessions", from, to], enabled: !!clubId, queryFn: () => list<ClassSession>(`/clubs/${clubId}/class-sessions${qs({ from, to })}`) });
export const useSession = (clubId: string | undefined, id: string | null | undefined) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "session", id], enabled: !!clubId && !!id, queryFn: () => api.get<ClassSessionDetail>(`/clubs/${clubId}/class-sessions/${id}`) });
export type NewSession = { class_type_id: string; date: string; time: string; duration_min?: number; capacity?: number; location_id?: string | null; instructor_membership_id?: string | null; notes?: string };
export const useCreateSession = (clubId: string) =>
  useMutation({ mutationFn: (v: NewSession) => api.post<ClassSessionDetail>(`/clubs/${clubId}/class-sessions`, v), onSuccess: () => refresh(clubId) });
export const useUpdateSession = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: { id: string; status?: "cancelled"; cancel_reason?: string; capacity?: number; notes?: string | null }) =>
    api.patch<ClassSessionDetail>(`/clubs/${clubId}/class-sessions/${id}`, v),
  onSuccess: () => refresh(clubId),
});

export const useBook = (clubId: string) => useMutation({
  mutationFn: (v: { session_id: string; membership_id?: string }) =>
    api.post<Booking>(`/clubs/${clubId}/class-sessions/${v.session_id}/bookings`, v.membership_id ? { membership_id: v.membership_id } : {}),
  onSuccess: () => refresh(clubId),
});
export const useCancelBooking = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/bookings/${id}`), onSuccess: () => refresh(clubId) });
export const useMarkAttendance = (clubId: string) => useMutation({
  mutationFn: (v: { id: string; status: "attended" | "no_show" | "booked" }) => api.patch<Booking>(`/clubs/${clubId}/bookings/${v.id}`, { status: v.status }),
  onSuccess: () => refresh(clubId),
});
/** Check-in from the venue's QR: the club comes with the call (the QR's link names only the session). */
export const useCheckIn = () => useMutation({
  mutationFn: (v: { club_id: string; session_id: string; checkin_code: string }) =>
    api.post<Booking>(`/clubs/${v.club_id}/class-sessions/${v.session_id}/check-in`, { checkin_code: v.checkin_code }),
  onSuccess: (_b, v) => refresh(v.club_id),
});
