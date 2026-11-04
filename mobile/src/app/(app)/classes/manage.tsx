/**
 * W9 on the phone · Aulas (staff, from "Mais"; only for clubs with Funcional, Musculação or Natação, D-052): a day strip
 * (yesterday to six days ahead, so last night's attendance can still be marked), that day's classes with bookings and
 * waitlists, and the class sheet (roster, attendance, add a student, capacity, the check-in QR, cancel). Venues, class
 * types and recurring schedules are set up on the web.
 */
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useClassSessions } from "@/api/classes";
import { SessionRow, dayLabel } from "@/components/classes/parts";
import { ClassSessionSheet } from "@/components/staff/ClassSessionSheet";
import { LoadError } from "@/components/workout/states";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { addDays, today as todayFn, upperFirst, weekdayShort } from "@/lib/format";
import { openOnWeb } from "@/lib/web";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, EmptyState, Screen, Skeleton, Text } from "@/ui";
import { CalendarClock, ExternalLink } from "@/ui/icons";

export default function ClassesManageScreen() {
  const { theme } = useTheme();
  const { club } = useClub();
  const tz = club?.timezone ?? "America/Sao_Paulo";
  const today = todayFn(tz);
  const [day, setDay] = useState(today);
  const [open, setOpen] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const sessions = useClassSessions(club?.id, day, day);
  if (!club) return null;
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, i - 1));
  const list = sessions.data ?? [];
  const refresh = async () => { setRefreshing(true); await sessions.refetch(); setRefreshing(false); };
  const c = theme.color;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Text tone="muted">{t("As aulas do dia, quem reservou e a lista de espera. Toque numa aula para a presença e o QR de check-in.")}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }} accessibilityRole="tablist">
        {days.map((d) => {
          const on = d === day;
          return (
            <Pressable key={d} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={upperFirst(dayLabel(d, today))} onPress={() => setDay(d)}
              style={[styles.day, { minWidth: theme.space[16], minHeight: theme.size.touchMin, paddingHorizontal: theme.space[3], paddingVertical: theme.space[2], borderRadius: theme.radius.md, borderWidth: 1, borderColor: on ? c.brand.solid : c.line, backgroundColor: on ? c.brand.solid : c.surface }]}>
              <Text variant="caption" color={on ? c.brand.onSolid : c.fgMuted}>{d === today ? t("Hoje") : upperFirst(weekdayShort(d))}</Text>
              <Text variant="titleSm" color={on ? c.brand.onSolid : c.fg}>{d.slice(8, 10)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {sessions.isPending ? <Skeleton style={{ height: theme.space[20] * 2 }} /> : sessions.isError && !sessions.data ? (
        <LoadError error={sessions.error} retrying={sessions.isFetching} onRetry={() => void sessions.refetch()} />
      ) : list.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title={t("Nenhuma aula neste dia")}>{t("Os horários fixos e as aulas avulsas são configurados no computador.")}</EmptyState></Card>
      ) : (
        <View style={{ gap: theme.space[2] }}>
          {list.map((s) => <SessionRow key={s.id} s={s} tz={tz} staff onPress={() => setOpen(s.id)} />)}
        </View>
      )}
      <Button variant="ghost" icon={ExternalLink} onPress={() => void openOnWeb("/classes/manage")}>{t("Configurar horários, tipos e locais no computador")}</Button>
      <ClassSessionSheet clubId={club.id} tz={tz} today={today} sessionId={open} onClose={() => setOpen(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({ day: { alignItems: "center", justifyContent: "center" } });
