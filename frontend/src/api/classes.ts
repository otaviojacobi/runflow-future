/** Scheduling (aulas): venues, class types, recurring schedules, sessions, bookings, check-in. */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import type { Booking, ClassSchedule, ClassSession, ClassSessionDetail, ClassType, Venue } from "./types";

const k = (clubId: string) => ["clubs", clubId, "classes"] as const;
const refresh = (clubId: string) => { queryClient.invalidateQueries({ queryKey: k(clubId) }); queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "dashboard"] }); };
const list = <T,>(path: string) => api.get<{ items: T[] }>(path).then((r) => r.items);

export const useVenues = (clubId: string | undefined) => useQuery({ queryKey: [...k(clubId ?? ""), "venues"], enabled: !!clubId, queryFn: () => list<Venue>(`/clubs/${clubId}/locations`) });
export const useSaveVenue = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: Partial<Venue> & { name: string; kind: Venue["kind"] }) => (id ? api.patch<Venue>(`/clubs/${clubId}/locations/${id}`, v) : api.post<Venue>(`/clubs/${clubId}/locations`, v)),
  onSuccess: () => refresh(clubId),
});
export const useArchiveVenue = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/locations/${id}`), onSuccess: () => refresh(clubId) });

export const useClassTypes = (clubId: string | undefined) => useQuery({ queryKey: [...k(clubId ?? ""), "types"], enabled: !!clubId, queryFn: () => list<ClassType>(`/clubs/${clubId}/class-types`) });
export const useSaveClassType = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: Partial<ClassType> & Pick<ClassType, "name" | "sport" | "default_capacity" | "duration_min">) => (id ? api.patch<ClassType>(`/clubs/${clubId}/class-types/${id}`, v) : api.post<ClassType>(`/clubs/${clubId}/class-types`, v)),
  onSuccess: () => refresh(clubId),
});
export const useArchiveClassType = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/class-types/${id}`), onSuccess: () => refresh(clubId) });

export interface NewSchedule { class_type_id: string; weekdays: number[]; start_time: string; duration_min?: number; capacity?: number; location_id?: string | null; instructor_membership_id?: string | null }
export const useSchedules = (clubId: string | undefined) => useQuery({ queryKey: [...k(clubId ?? ""), "schedules"], enabled: !!clubId, queryFn: () => list<ClassSchedule>(`/clubs/${clubId}/class-schedules`) });
export const useCreateSchedule = (clubId: string) => useMutation({ mutationFn: (v: NewSchedule) => api.post<{ items: ClassSchedule[]; sessions: number }>(`/clubs/${clubId}/class-schedules`, v), onSuccess: () => refresh(clubId) });
export const useEndSchedule = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del<{ cancelled_sessions: number }>(`/clubs/${clubId}/class-schedules/${id}`), onSuccess: () => refresh(clubId) });

export const useSessions = (clubId: string | undefined, from: string, to: string) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "sessions", from, to], enabled: !!clubId, queryFn: () => list<ClassSession>(`/clubs/${clubId}/class-sessions${qs({ from, to })}`) });
export const useSession = (clubId: string | undefined, id: string | null) =>
  useQuery({ queryKey: [...k(clubId ?? ""), "session", id], enabled: !!clubId && !!id, queryFn: () => api.get<ClassSessionDetail>(`/clubs/${clubId}/class-sessions/${id}`) });
export const useCreateSession = (clubId: string) => useMutation({
  mutationFn: (v: { class_type_id: string; date: string; time: string; duration_min?: number; capacity?: number; location_id?: string | null; instructor_membership_id?: string | null; notes?: string }) => api.post<ClassSession>(`/clubs/${clubId}/class-sessions`, v),
  onSuccess: () => refresh(clubId),
});
export const useUpdateSession = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: { id: string; status?: "cancelled"; reason?: string; capacity?: number; notes?: string | null }) => api.patch<ClassSession>(`/clubs/${clubId}/class-sessions/${id}`, v),
  onSuccess: () => refresh(clubId),
});

export const useBook = (clubId: string) => useMutation({ mutationFn: (v: { session_id: string; membership_id?: string }) => api.post<Booking>(`/clubs/${clubId}/class-sessions/${v.session_id}/bookings`, { membership_id: v.membership_id }), onSuccess: () => refresh(clubId) });
export const useCancelBooking = (clubId: string) => useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/bookings/${id}`), onSuccess: () => refresh(clubId) });
export const useMarkAttendance = (clubId: string) => useMutation({ mutationFn: (v: { id: string; status: "attended" | "no_show" | "booked" }) => api.patch<Booking>(`/clubs/${clubId}/bookings/${v.id}`, { status: v.status }), onSuccess: () => refresh(clubId) });
export const useCheckIn = (clubId: string) => useMutation({ mutationFn: (v: { session_id: string; checkin_code: string }) => api.post<Booking>(`/clubs/${clubId}/class-sessions/${v.session_id}/check-in`, { checkin_code: v.checkin_code }), onSuccess: () => refresh(clubId) });
