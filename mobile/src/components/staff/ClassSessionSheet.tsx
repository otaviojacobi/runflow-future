/**
 * W9 on the phone · One class for staff (G5, D-052): the seats and the waitlist, attendance (presente / faltou), adding a
 * student, the capacity, the check-in QR and its code to show at the venue, and cancelling the class (everyone booked
 * or waiting is told). Venues, class types and schedules are set up on the web.
 */
import { useState } from "react";
import { View } from "react-native";
import { useBookClass, useCancelBooking, useSetAttendance, useStaffClassSession, useUpdateClassSession } from "@/api/classes";
import { useAthletes } from "@/api/staff";
import type { StaffClassSession } from "@/api/types";
import { Stepper } from "@/components/account/parts";
import { BookingBadge, seatsText, whenLabel } from "@/components/classes/parts";
import { QrCode } from "@/components/QrCode";
import { SportChip } from "@/components/sport";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { timeOf } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Badge, Button, Card, Dialog, Field, IconButton, Input, ListItem, Menu, Select, Skeleton, Text, toast } from "@/ui";
import { Ban, Check, Ellipsis, MapPin, QrCode as QrIcon, RotateCcw, UserMinus, UserPlus, X } from "@/ui/icons";

type Row = StaffClassSession["roster"][number];

export function ClassSessionSheet({ clubId, tz, today, sessionId, onClose }: { clubId: string; tz: string; today: string; sessionId: string | null; onClose: () => void }) {
  const { theme } = useTheme();
  const q = useStaffClassSession(clubId, sessionId);
  const s = q.data;
  const update = useUpdateClassSession(clubId);
  const [mode, setMode] = useState<"view" | "cancel">("view");
  const [reason, setReason] = useState("");
  const close = () => { setMode("view"); setReason(""); onClose(); };
  const cancelSession = () => s && update.mutate({ id: s.id, status: "cancelled", cancel_reason: reason.trim() || null }, {
    onSuccess: () => { toast.success(t("Aula cancelada"), t("Quem estava reservado ou na espera recebe um aviso.")); setMode("view"); void q.refetch(); },
    onError: (e) => toast.error(e),
  });
  const footer = !s || s.status === "cancelled" ? null
    : mode === "cancel" ? <><Button variant="ghost" onPress={() => setMode("view")}>{t("Voltar")}</Button><Button variant="danger" loading={update.isPending} onPress={cancelSession}>{t("Cancelar aula")}</Button></>
    : <Button variant="ghost" icon={Ban} onPress={() => setMode("cancel")}>{t("Cancelar aula")}</Button>;

  return (
    <Dialog open={!!sessionId} onOpenChange={(v) => !v && close()} footer={footer}
      title={mode === "cancel" ? t("Cancelar esta aula?") : s?.class_type.name ?? t("Aula")}
      description={mode === "cancel" ? t("Quem está reservado ou na lista de espera recebe um aviso. Não dá para desfazer.") : s ? `${whenLabel(s, tz, today)}–${timeOf(s.ends_at, tz)}` : null}>
      {q.isPending ? <Skeleton style={{ height: theme.space[20] * 3 }} /> : !s ? (
        <Text tone="muted">{q.error instanceof ApiError ? q.error.detail : t("Não foi possível abrir esta aula.")}</Text>
      ) : mode === "cancel" ? (
        <Field label={t("Motivo")} optional hint={t("Vai junto no aviso, ex.: \"Piscina em manutenção\".")}>
          {(a) => <Input {...a} value={reason} onChangeText={setReason} maxLength={200} />}
        </Field>
      ) : <Body s={s} tz={tz} clubId={clubId} />}
    </Dialog>
  );
}

function Body({ s, tz, clubId }: { s: StaffClassSession; tz: string; clubId: string }) {
  const { theme } = useTheme();
  const [showQr, setShowQr] = useState(false);
  const [capacity, setCapacity] = useState<number | null>(null);
  const update = useUpdateClassSession(clubId);
  const seated = s.roster.filter((b) => b.status !== "waitlisted");
  const waiting = s.roster.filter((b) => b.status === "waitlisted");
  const cancelled = s.status === "cancelled";
  const saveCapacity = () => capacity != null && update.mutate({ id: s.id, capacity }, {
    onSuccess: () => { toast.success(t("Vagas atualizadas"), capacity > s.capacity && waiting.length ? t("Quem estava na espera entrou e recebe um aviso.") : undefined); setCapacity(null); },
    onError: (e) => toast.error(e),
  });
  return (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
        <SportChip sport={s.class_type.sport} size="sm" />
        {cancelled ? <Badge tone="danger">{t("Cancelada")}</Badge> : <Badge>{seatsText(s)}</Badge>}
      </View>
      {s.location ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space[2] }}>
          <MapPin size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden />
          <Text tone="muted" style={{ flex: 1 }}>{[s.location.name, s.instructor?.name].filter(Boolean).join(" · ")}</Text>
        </View>
      ) : null}
      {cancelled ? <Card edge="danger" style={{ padding: theme.space[4], gap: theme.space[1] }}><Text variant="titleSm">{t("Esta aula foi cancelada")}</Text>{s.cancel_reason ? <Text tone="muted">{s.cancel_reason}</Text> : null}</Card> : (
        <>
          <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
            <Button variant={showQr ? "ghost" : "secondary"} icon={QrIcon} onPress={() => setShowQr((v) => !v)}>{showQr ? t("Esconder o QR") : t("Mostrar o QR de check-in")}</Button>
            {showQr ? (
              <View style={{ gap: theme.space[2], alignItems: "center" }}>
                <QrCode value={s.checkin_url} size={theme.space[20] * 3} label={t("QR de check-in desta aula")} />
                <Text variant="caption" tone="muted">{t("Código para digitar")}</Text>
                <Text variant="titleLg" selectable accessibilityLabel={t("Código {code}", { code: s.checkin_code.split("").join(" ") })} style={{ letterSpacing: theme.space[1] }}>{s.checkin_code}</Text>
                <Text variant="caption" tone="muted" style={{ textAlign: "center" }}>{t("Os alunos leem no app, em Aulas, de 45 minutos antes do início até o fim.")}</Text>
              </View>
            ) : null}
          </Card>
          <View style={{ gap: theme.space[2] }}>
            <Stepper label={t("Vagas")} value={capacity ?? s.capacity} onChange={(v) => setCapacity(v === s.capacity ? null : v)} min={1} max={500} format={(v) => tn(v, "{n} vaga", "{n} vagas")} />
            {capacity != null ? <Button size="sm" loading={update.isPending} onPress={saveCapacity}>{t("Salvar vagas")}</Button> : null}
          </View>
        </>
      )}
      <View style={{ gap: theme.space[2] }}>
        <Text variant="titleSm" accessibilityRole="header">{t("Reservas ({n}/{c})", { n: seated.length, c: s.capacity })}</Text>
        {seated.length === 0 ? <Text tone="muted">{t("Ninguém reservou ainda.")}</Text> : seated.map((b) => <RosterRow key={b.id} b={b} clubId={clubId} cancelled={cancelled} />)}
      </View>
      {waiting.length ? (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="titleSm" accessibilityRole="header">{t("Lista de espera ({n})", { n: waiting.length })}</Text>
          {waiting.map((b) => <RosterRow key={b.id} b={b} clubId={clubId} cancelled={cancelled} />)}
        </View>
      ) : null}
      {cancelled ? null : <AddStudent clubId={clubId} s={s} />}
    </View>
  );
}

/** A person in the class: the state, and attendance or removal from a menu. */
function RosterRow({ b, clubId, cancelled }: { b: Row; clubId: string; cancelled: boolean }) {
  const attend = useSetAttendance(clubId);
  const remove = useCancelBooking(clubId);
  const set = (status: "attended" | "no_show" | "booked", ok: string) => attend.mutate({ bookingId: b.id, status }, { onSuccess: () => toast.success(ok), onError: (e) => toast.error(e) });
  const items = b.status === "waitlisted"
    ? [{ label: t("Tirar da lista de espera"), icon: UserMinus, danger: true, onSelect: () => remove.mutate(b.id, { onSuccess: () => toast.success(t("Saiu da lista de espera")), onError: (e) => toast.error(e) }) }]
    : [
      ...(b.status !== "attended" ? [{ label: t("Presente"), icon: Check, onSelect: () => set("attended", t("Presença marcada")) }] : []),
      ...(b.status !== "no_show" ? [{ label: t("Faltou"), icon: X, onSelect: () => set("no_show", t("Falta marcada")) }] : []),
      ...(b.status !== "booked" ? [{ label: t("Voltar para reservado"), icon: RotateCcw, onSelect: () => set("booked", t("Voltou para reservado")) }] : []),
      "separator" as const,
      { label: t("Tirar da aula"), icon: UserMinus, danger: true, onSelect: () => remove.mutate(b.id, { onSuccess: () => toast.success(t("Reserva cancelada")), onError: (e) => toast.error(e) }) },
    ];
  return (
    <ListItem title={b.athlete.user.name} leading={<Avatar name={b.athlete.user.name} src={b.athlete.user.avatar_url} />}
      subtitle={b.status === "waitlisted" ? t("{n}º na espera", { n: b.waitlist_position ?? 1 }) : undefined}
      trailing={(
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {b.status !== "waitlisted" ? <BookingBadge booking={b} /> : null}
          {cancelled ? null : <Menu title={b.athlete.user.name} items={items} trigger={(open) => (
            <IconButton icon={Ellipsis} label={t("Ações para {name}", { name: b.athlete.user.name })} disabled={attend.isPending || remove.isPending} onPress={open} />
          )} />}
        </View>
      )} />
  );
}

/** Staff book an active student (a full class puts them on the waitlist). */
function AddStudent({ clubId, s }: { clubId: string; s: StaffClassSession }) {
  const { theme } = useTheme();
  const athletes = useAthletes(clubId);
  const book = useBookClass(clubId);
  const inClass = new Set(s.roster.map((b) => b.membership_id));
  const options = (athletes.data ?? []).filter((a) => a.membership.status === "active" && !inClass.has(a.membership.id))
    .map((a) => ({ value: a.membership.id, label: a.user.name }));
  return (
    <View style={{ gap: theme.space[2] }}>
      <Select<string> value={null} options={options} title={t("Adicionar aluno")} placeholder={t("Adicionar aluno…")} accessibilityLabel={t("Adicionar aluno à aula")}
        disabled={book.isPending || options.length === 0}
        onChange={(id) => book.mutate({ sessionId: s.id, membershipId: id }, {
          onSuccess: (b) => toast.success(b.status === "waitlisted" ? t("Aula lotada: entrou na lista de espera ({n}º)", { n: b.waitlist_position ?? 1 }) : t("Aluno adicionado")),
          onError: (e) => toast.error(e),
        })} />
      {options.length === 0 && !athletes.isPending ? <Text variant="caption" tone="muted">{t("Todos os alunos ativos já estão nesta aula.")}</Text> : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space[1] }}>
        <UserPlus size={theme.size.iconSm} color={theme.color.fgSubtle} aria-hidden />
        <Text variant="caption" tone="subtle">{t("O aluno recebe a vaga como se tivesse reservado.")}</Text>
      </View>
    </View>
  );
}
