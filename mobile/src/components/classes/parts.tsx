/**
 * Aulas' shared pieces (D-052, G5): times in club time, seat counts, the booking badge, a session row, the check-in
 * window and the parsing of a scanned check-in link.
 */
import { Pressable, StyleSheet, View } from "react-native";
import { seatsLeft } from "@/api/classes";
import type { ClassBooking, ClassSession } from "@/api/types";
import { SportChip } from "@/components/sport";
import { t, tn } from "@/i18n";
import { addDays, localDate, shortDate, timeOf } from "@/lib/format";
import { queryOf } from "@/lib/query";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Text } from "@/ui";
import { ChevronRight } from "@/ui/icons";

/** Students check in from 45 minutes before the start until the end (api/endpoints.md § Aulas). */
export const CHECKIN_EARLY_MS = 45 * 60_000;
export const canCheckIn = (s: Pick<ClassSession, "starts_at" | "ends_at" | "status">, now = Date.now()) =>
  s.status === "scheduled" && now >= Date.parse(s.starts_at) - CHECKIN_EARLY_MS && now <= Date.parse(s.ends_at);
export const hasStarted = (s: Pick<ClassSession, "starts_at">, now = Date.now()) => now >= Date.parse(s.starts_at);

/** "07:00–08:00" in club time. */
export const sessionTime = (s: Pick<ClassSession, "starts_at" | "ends_at">, tz: string) => `${timeOf(s.starts_at, tz)}–${timeOf(s.ends_at, tz)}`;
/** "Hoje" / "Amanhã" / "qui, 6 nov" for a club-local day. */
export const dayLabel = (day: string, today: string) => (day === today ? t("Hoje") : day === addDays(today, 1) ? t("Amanhã") : shortDate(day));
/** "Hoje, 07:00" / "qui, 6 nov, 07:00". */
export const whenLabel = (s: Pick<ClassSession, "starts_at">, tz: string, today: string) => `${dayLabel(localDate(s.starts_at, tz), today)}, ${timeOf(s.starts_at, tz)}`;

/** "3 vagas" / "1 vaga" / "Lotada", plus "· 2 na espera". */
export function seatsText(s: Pick<ClassSession, "capacity" | "booked" | "waitlist">) {
  const left = seatsLeft(s);
  const seats = left > 0 ? tn(left, "{n} vaga", "{n} vagas") : t("Lotada");
  return s.waitlist > 0 ? `${seats} · ${tn(s.waitlist, "{n} na espera", "{n} na espera")}` : seats;
}

/** The person's booking state: reservado, lista de espera (position), presente, faltou. */
export function BookingBadge({ booking }: { booking: ClassBooking }) {
  switch (booking.status) {
    case "booked": return <Badge tone="success">{t("Reservado")}</Badge>;
    case "waitlisted": return <Badge tone="warning">{booking.waitlist_position ? t("Lista de espera · {n}º", { n: booking.waitlist_position }) : t("Lista de espera")}</Badge>;
    case "attended": return <Badge tone="info">{t("Presente")}</Badge>;
    case "no_show": return <Badge tone="danger">{t("Faltou")}</Badge>;
    default: return null;
  }
}

/** One session in a list: the time, the class and its sport, where and with whom, then seats or my booking. */
export function SessionRow({ s, tz, onPress, staff }: { s: ClassSession; tz: string; onPress: () => void; staff?: boolean }) {
  const { theme } = useTheme();
  const c = theme.color;
  const cancelled = s.status === "cancelled";
  const where = [s.location?.name, s.instructor?.name.split(" ")[0]].filter(Boolean).join(" · ");
  const b = s.my_booking;
  const mine = b && (b.status === "booked" || b.status === "waitlisted" || b.status === "attended") ? b : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${s.class_type.name}, ${sessionTime(s, tz)}`} onPress={onPress}
      style={({ pressed }) => [styles.row, { gap: theme.space[3], padding: theme.space[3], minHeight: theme.size.touchMin, borderRadius: theme.radius.lg, borderWidth: 1, borderColor: c.lineSubtle, backgroundColor: pressed ? c.soft : c.surface, opacity: cancelled ? 0.7 : 1 }]}>
      <View style={{ width: theme.space[16] }}>
        <Text variant="titleSm" style={styles.tabular}>{timeOf(s.starts_at, tz)}</Text>
        <Text variant="caption" tone="muted" style={styles.tabular}>{timeOf(s.ends_at, tz)}</Text>
      </View>
      <View style={[styles.flex, { gap: theme.space[1] }]}>
        {/* The name gets the whole width (class names are long: "Musculação: força para corredores"). */}
        <Text variant="titleSm" numberOfLines={2}>{s.class_type.name}</Text>
        {where ? <Text variant="caption" tone="muted" numberOfLines={1}>{where}</Text> : null}
        <View style={[styles.row, styles.wrap, { gap: theme.space[2] }]}>
          <SportChip sport={s.class_type.sport} size="sm" />
          {cancelled ? <Badge tone="danger">{t("Cancelada")}</Badge>
            : staff ? <Text variant="caption" tone={seatsLeft(s) > 0 ? "muted" : "warning"} style={styles.tabular}>{t("{b}/{c} reservas", { b: s.booked, c: s.capacity })}{s.waitlist ? ` · ${tn(s.waitlist, "{n} na espera", "{n} na espera")}` : ""}</Text>
            : mine ? <BookingBadge booking={mine} />
            : <Text variant="caption" tone={seatsLeft(s) > 0 ? "muted" : "warning"}>{seatsText(s)}</Text>}
        </View>
      </View>
      <ChevronRight size={theme.size.iconSm} color={c.fgSubtle} aria-hidden />
    </Pressable>
  );
}

/**
 * A scanned check-in QR (`<app>/classes/check-in?session=<id>&code=<code>`) or a typed code. A bare code needs the
 * session from the screen it was typed on.
 */
export function parseCheckIn(data: string): { session: string | null; code: string } | null {
  const s = data.trim();
  if (!s) return null;
  if (s.includes("check-in") && s.includes("?")) {
    const q = queryOf(s);
    return q.code ? { session: q.session ?? null, code: q.code.toUpperCase() } : null;
  }
  return /^[A-Za-z0-9]{4,10}$/.test(s) ? { session: null, code: s.toUpperCase() } : null;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  wrap: { flexWrap: "wrap" },
  flex: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  tabular: { fontVariant: ["tabular-nums"] },
});
