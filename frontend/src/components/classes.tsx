/** Shared bits for Aulas (D-052): staff W9 and student M6. */
import type { BookingStatus, ClassSession, VenueKind } from "@/api/types";
import { t, tn } from "@/i18n";
import { timeOf } from "@/lib/format";
import { Badge, Input, cn, type Tone } from "@/ui";

/** ISO weekday (1 = Monday) → pt-BR label. */
export const WEEKDAY_SHORT = ["", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"] as const;
export const WEEKDAY_LONG = ["", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"] as const;
export const VENUE_KINDS: VenueKind[] = ["gym", "studio", "pool", "track", "park", "other"];
export const VENUE_LABEL: Record<VenueKind, string> = { track: "Pista", park: "Parque", pool: "Piscina", gym: "Academia", studio: "Estúdio", other: "Outro" };

/** Check-in opens 45 min before the start and closes at the end (the API's rule). */
export const CHECKIN_LEAD_MS = 45 * 60_000;
export const checkinOpen = (s: Pick<ClassSession, "starts_at" | "ends_at">, now = Date.now()) => now >= Date.parse(s.starts_at) - CHECKIN_LEAD_MS && now <= Date.parse(s.ends_at);
export const isPast = (s: Pick<ClassSession, "ends_at">, now = Date.now()) => Date.parse(s.ends_at) < now;
export const hasStarted = (s: Pick<ClassSession, "starts_at">, now = Date.now()) => Date.parse(s.starts_at) <= now;
export const timeRange = (s: Pick<ClassSession, "starts_at" | "ends_at">, tz?: string) => `${timeOf(s.starts_at, tz)}–${timeOf(s.ends_at, tz)}`;
export const spotsLeft = (s: Pick<ClassSession, "capacity" | "booked">) => Math.max(0, s.capacity - s.booked);

/** "0730" → "07:30" while typing; a 24 h clock whatever the browser's language. */
export const maskTime = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d; };
export const validTime = (v: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

/** A time of day typed as HH:MM (24 h). The browser's time input follows its language (AM/PM in English). */
export function TimeInput({ id, value, onChange, invalid, className }: { id?: string; value: string; onChange: (v: string) => void; invalid?: boolean; className?: string }) {
  return (
    <Input id={id} value={value} inputMode="numeric" autoComplete="off" placeholder="07:00" maxLength={5} invalid={invalid || (value.length === 5 && !validTime(value))}
      onChange={(e) => onChange(maskTime(e.target.value))} className={cn("tabular-nums", className)} />
  );
}

/** Seats taken out of the capacity, and the waitlist. */
export function Occupancy({ s, className }: { s: Pick<ClassSession, "capacity" | "booked" | "waitlist">; className?: string }) {
  const pct = Math.min(100, Math.round((s.booked / Math.max(1, s.capacity)) * 100));
  const full = s.booked >= s.capacity;
  return (
    <div className={cn("grid gap-1", className)}>
      <div className="h-1.5 overflow-hidden rounded-full bg-soft" role="meter" aria-valuemin={0} aria-valuemax={s.capacity} aria-valuenow={s.booked} aria-label={t("Ocupação: {a} de {b} vagas", { a: s.booked, b: s.capacity })}>
        <div className={cn("h-full rounded-full", full ? "bg-warning" : "bg-fg-muted")} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between gap-2 text-[11px] text-fg-muted tabular-nums">
        <span>{s.booked}/{s.capacity}</span>
        {s.waitlist > 0 ? <span className="font-semibold text-warning-text">{tn(s.waitlist, "{n} na fila", "{n} na fila")}</span> : full ? <span className="font-semibold text-warning-text">{t("Lotada")}</span> : null}
      </div>
    </div>
  );
}

const BOOKING: Record<BookingStatus, { label: string; tone: Tone }> = {
  booked: { label: "Reservado", tone: "info" },
  waitlisted: { label: "Na fila", tone: "warning" },
  attended: { label: "Presente", tone: "success" },
  no_show: { label: "Faltou", tone: "danger" },
  cancelled: { label: "Cancelado", tone: "neutral" },
};
export function BookingBadge({ status, position }: { status: BookingStatus; position?: number | null }) {
  const b = BOOKING[status];
  return <Badge tone={b.tone}>{status === "waitlisted" && position ? t("{n}º na fila", { n: position }) : t(b.label)}</Badge>;
}
