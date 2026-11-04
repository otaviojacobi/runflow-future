/**
 * Aulas (D-052, api/endpoints.md § Aulas; G5): the club's class sessions, bookings with a waitlist, check-in and the
 * staff's roster and attendance. Venues, class types and schedules are set up on the web (W9).
 */
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, qs } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { myKey } from "./my";
import type { ClassBooking, ClassSession, ID, ISODate, StaffClassSession } from "./types";

export const classKeys = {
  all: (clubId: string) => ["clubs", clubId, "classes"] as const,
  sessions: (clubId: string, from: ISODate, to: ISODate) => ["clubs", clubId, "classes", "sessions", from, to] as const,
  session: (clubId: string, id: ID) => ["clubs", clubId, "classes", "session", id] as const,
};

/** After any booking change: every list, the open session, Hoje's next class and the dashboard's upcoming classes. */
const refresh = (clubId: string) => {
  void queryClient.invalidateQueries({ queryKey: classKeys.all(clubId) });
  void queryClient.invalidateQueries({ queryKey: [...myKey(clubId), "summary"] });
  void queryClient.invalidateQueries({ queryKey: ["clubs", clubId, "dashboard"] });
};

/** Sessions starting on club-local days [from, to], by start (students get scheduled ones only). */
export const useClassSessions = (clubId: string | undefined, from: ISODate, to: ISODate, enabled = true) =>
  useQuery({
    queryKey: classKeys.sessions(clubId ?? "", from, to), enabled: !!clubId && enabled,
    queryFn: () => api.get<{ items: ClassSession[] }>(`/clubs/${clubId}/class-sessions${qs({ from, to })}`).then((r) => r.items),
  });

/** One session. Staff get the roster and the check-in code; students the plain session with `my_booking`. */
export const useClassSession = <T extends ClassSession = ClassSession>(clubId: string | undefined, id: ID | null | undefined) =>
  useQuery({
    queryKey: classKeys.session(clubId ?? "", id ?? ""), enabled: !!clubId && !!id,
    queryFn: () => api.get<T>(`/clubs/${clubId}/class-sessions/${id}`),
  });
export const useStaffClassSession = (clubId: string | undefined, id: ID | null | undefined) => useClassSession<StaffClassSession>(clubId, id);

/** Book (a student themself; staff pass `membership_id` for an active student). Full → waitlisted with its position. */
export const useBookClass = (clubId: string) => useMutation({
  mutationFn: ({ sessionId, membershipId }: { sessionId: ID; membershipId?: ID }) =>
    api.post<ClassBooking>(`/clubs/${clubId}/class-sessions/${sessionId}/bookings`, membershipId ? { membership_id: membershipId } : {}),
  onSuccess: () => refresh(clubId),
});
/** Cancel a booking (students their own until the class starts; staff any). The waitlist moves up. */
export const useCancelBooking = (clubId: string) => useMutation({
  mutationFn: (bookingId: ID) => api.del(`/clubs/${clubId}/bookings/${bookingId}`),
  onSuccess: () => refresh(clubId),
});
/** Check in with the session's code (45 min before the start until the end): attended, a seat taken if free. */
export const useCheckIn = (clubId: string) => useMutation({
  mutationFn: ({ sessionId, code }: { sessionId: ID; code: string }) =>
    api.post<ClassBooking>(`/clubs/${clubId}/class-sessions/${sessionId}/check-in`, { checkin_code: code.trim().toUpperCase() }),
  onSuccess: () => refresh(clubId),
});
/** Staff: attendance (attended, no-show, or back to booked). */
export const useSetAttendance = (clubId: string) => useMutation({
  mutationFn: ({ bookingId, status }: { bookingId: ID; status: "attended" | "no_show" | "booked" }) =>
    api.patch<ClassBooking>(`/clubs/${clubId}/bookings/${bookingId}`, { status }),
  onSuccess: () => refresh(clubId),
});
/** Staff: cancel the session (everyone booked or waiting is told) or change its capacity (raising promotes the waitlist). */
export const useUpdateClassSession = (clubId: string) => useMutation({
  mutationFn: ({ id, ...v }: { id: ID } & ({ status: "cancelled"; cancel_reason?: string | null } | { capacity: number })) =>
    api.patch<StaffClassSession>(`/clubs/${clubId}/class-sessions/${id}`, v),
  onSuccess: () => refresh(clubId),
});

/** "3 vagas" / "Lotada" style counts for a session. */
export const seatsLeft = (s: Pick<ClassSession, "capacity" | "booked">) => Math.max(0, s.capacity - s.booked);
/** A booking still holds or waits for a seat (not cancelled, not already attended or missed). */
export const isOpenBooking = (b: ClassBooking | null | undefined): b is ClassBooking => !!b && (b.status === "booked" || b.status === "waitlisted");
