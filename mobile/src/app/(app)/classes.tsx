/**
 * M6 · Aulas (student; a tab only for clubs with Funcional, Musculação or Natação, D-052): my bookings, then the next
 * 14 days of classes by day with the seats left. A class opens as a sheet (book, waitlist, cancel, check in);
 * `?session=<id>` opens one directly (Hoje's next class, the class notifications' links).
 */
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { isOpenBooking, useClassSessions } from "@/api/classes";
import type { ClassSession } from "@/api/types";
import { SessionRow, dayLabel } from "@/components/classes/parts";
import { StudentSessionSheet } from "@/components/classes/StudentSessionSheet";
import { LoadError } from "@/components/workout/states";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { addDays, localDate, today as todayFn, upperFirst } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, EmptyState, Screen, Skeleton, Text } from "@/ui";
import { CalendarClock } from "@/ui/icons";

const DAYS = 14;

export default function ClassesScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const params = useLocalSearchParams<{ session?: string }>();
  const tz = club?.timezone ?? "America/Sao_Paulo";
  const today = todayFn(tz);
  const sessions = useClassSessions(club?.id, today, addDays(today, DAYS - 1));
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // A link (?session=…) opens that class; closing the sheet forgets it so the next visit starts on the list.
  useEffect(() => { if (params.session) setOpen(params.session); }, [params.session]);
  if (!club) return null;
  const close = () => { setOpen(null); if (params.session) router.setParams({ session: undefined }); };

  const now = Date.now();
  const all = (sessions.data ?? []).filter((s) => Date.parse(s.ends_at) > now);
  // The next three of my bookings up top; every class still shows under its day (with its badge).
  const mine = all.filter((s) => isOpenBooking(s.my_booking)).slice(0, 3);
  const byDay = new Map<string, ClassSession[]>();
  for (const s of all) {
    const d = localDate(s.starts_at, tz);
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }
  const refresh = async () => { setRefreshing(true); await sessions.refetch(); setRefreshing(false); };
  const section = (title: string, list: ClassSession[]) => (
    <View key={title} style={{ gap: theme.space[2] }}>
      <Text variant="overline" tone="muted" accessibilityRole="header">{title}</Text>
      {list.map((s) => <SessionRow key={s.id} s={s} tz={tz} onPress={() => setOpen(s.id)} />)}
    </View>
  );

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text tone="muted">{t("Reserve sua vaga. Chegando, faça o check-in com o QR da aula.")}</Text>
      {sessions.isPending ? (
        <View style={{ gap: theme.space[3] }} accessibilityLabel={t("Carregando…")}>
          <Skeleton style={{ height: theme.space[20] }} />
          <Skeleton style={{ height: theme.space[20] * 2 }} />
        </View>
      ) : sessions.isError && !sessions.data ? (
        <LoadError error={sessions.error} retrying={sessions.isFetching} onRetry={() => void sessions.refetch()} />
      ) : all.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title={t("Nenhuma aula nos próximos dias")}>{t("Quando {club} abrir horários, eles aparecem aqui.", { club: club.name })}</EmptyState></Card>
      ) : (
        <>
          {mine.length > 0 && section(t("Minhas reservas"), mine)}
          {[...byDay.entries()].map(([day, list]) => section(upperFirst(dayLabel(day, today)), list))}
        </>
      )}
      <StudentSessionSheet clubId={club.id} tz={tz} today={today} sessionId={open} onClose={close} />
    </Screen>
  );
}
