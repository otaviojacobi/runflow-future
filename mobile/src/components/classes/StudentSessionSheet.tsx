/**
 * M6 · A class for the student (the bottom sheet behind every session in Aulas, Hoje's next class and the class
 * notifications): when, where, with whom and the seats left; book, join the waitlist, cancel before the start; check in
 * from 45 minutes before the start until the end by reading the QR at the venue or typing its code.
 */
import { useState } from "react";
import { View } from "react-native";
import { isOpenBooking, seatsLeft, useBookClass, useCancelBooking, useCheckIn, useClassSession } from "@/api/classes";
import type { ClassSession } from "@/api/types";
import { SportChip } from "@/components/sport";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { timeOf } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Button, Card, Dialog, Field, Input, Skeleton, Text, toast } from "@/ui";
import { CircleCheck, Clock, MapPin, ScanQrCode, User } from "@/ui/icons";
import { BookingBadge, canCheckIn, hasStarted, parseCheckIn, seatsText, whenLabel } from "./parts";
import { QrScanner, scannerAvailable } from "./QrScanner";

export function StudentSessionSheet({ clubId, tz, today, sessionId, onClose }: { clubId: string; tz: string; today: string; sessionId: string | null; onClose: () => void }) {
  const { theme } = useTheme();
  const q = useClassSession(clubId, sessionId);
  const s = q.data;
  const book = useBookClass(clubId);
  const cancel = useCancelBooking(clubId);
  const mine = s?.my_booking ?? null;
  const open = isOpenBooking(mine) ? mine : null;
  const started = s ? hasStarted(s) : false;
  const full = s ? seatsLeft(s) === 0 : false;

  const doBook = () => s && book.mutate({ sessionId: s.id }, {
    onSuccess: (b) => {
      toast.success(b.status === "waitlisted"
        ? t("Você entrou na lista de espera ({n}º)", { n: b.waitlist_position ?? 1 })
        : t("Vaga reservada"), b.status === "waitlisted" ? t("Se abrir uma vaga, ela é sua e você recebe um aviso.") : undefined);
      void q.refetch();
    },
    onError: (e) => toast.error(e),
  });
  const doCancel = () => open && cancel.mutate(open.id, {
    onSuccess: () => { toast.success(open.status === "waitlisted" ? t("Você saiu da lista de espera") : t("Reserva cancelada")); void q.refetch(); },
    onError: (e) => toast.error(e),
  });

  const footer = !s || s.status === "cancelled" ? null
    : open && !started ? <Button variant="secondary" loading={cancel.isPending} onPress={doCancel}>{open.status === "waitlisted" ? t("Sair da lista de espera") : t("Cancelar reserva")}</Button>
    : !mine || mine.status === "cancelled" ? (started ? null : <Button loading={book.isPending} onPress={doBook}>{full ? t("Entrar na lista de espera") : t("Reservar vaga")}</Button>)
    : null;

  return (
    <Dialog open={!!sessionId} onOpenChange={(v) => !v && onClose()} title={s?.class_type.name ?? t("Aula")}
      description={s ? `${whenLabel(s, tz, today)}–${timeOf(s.ends_at, tz)}` : null} footer={footer}>
      {q.isPending ? <Skeleton style={{ height: theme.space[20] * 2 }} /> : !s ? (
        <Text tone="muted">{q.error instanceof ApiError ? q.error.detail : t("Não foi possível abrir esta aula.")}</Text>
      ) : <Body s={s} tz={tz} clubId={clubId} onCheckedIn={() => void q.refetch()} />}
    </Dialog>
  );
}

function Body({ s, tz, clubId, onCheckedIn }: { s: ClassSession; tz: string; clubId: string; onCheckedIn: () => void }) {
  const { theme } = useTheme();
  const mine = s.my_booking;
  const line = (Icon: typeof Clock, text: string) => (
    <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space[2] }}>
      <Icon size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden />
      <Text style={{ flex: 1 }}>{text}</Text>
    </View>
  );
  return (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: theme.space[2], flexWrap: "wrap" }}>
        <SportChip sport={s.class_type.sport} size="sm" />
        {s.status === "cancelled" ? <Badge tone="danger">{t("Cancelada")}</Badge> : mine && mine.status !== "cancelled" ? <BookingBadge booking={mine} /> : <Badge tone={seatsLeft(s) > 0 ? "neutral" : "warning"}>{seatsText(s)}</Badge>}
      </View>
      {/* The time is in the sheet's description already. */}
      {s.location || s.instructor ? (
        <View style={{ gap: theme.space[2] }}>
          {s.location ? line(MapPin, [s.location.name, s.location.address].filter(Boolean).join(" · ")) : null}
          {s.instructor ? line(User, s.instructor.name) : null}
        </View>
      ) : null}
      {s.class_type.description ? <Text tone="muted">{s.class_type.description}</Text> : null}
      {s.notes ? <Card style={{ padding: theme.space[4] }}><Text>{s.notes}</Text></Card> : null}
      {s.status === "cancelled" ? (
        <Card edge="danger" style={{ padding: theme.space[4], gap: theme.space[1] }}><Text variant="titleSm">{t("Esta aula foi cancelada")}</Text>{s.cancel_reason ? <Text tone="muted">{s.cancel_reason}</Text> : null}</Card>
      ) : mine?.status === "attended" ? (
        <Card style={{ padding: theme.space[4] }}><View style={{ flexDirection: "row", alignItems: "center", gap: theme.space[2] }}>
          <CircleCheck size={theme.size.iconMd} color={theme.color.success.text} aria-hidden />
          <Text style={{ flex: 1 }}>{mine.checked_in_at ? t("Check-in feito às {time}.", { time: timeOf(mine.checked_in_at, tz) }) : t("Presença confirmada.")}</Text>
        </View></Card>
      ) : mine?.status === "waitlisted" ? (
        <Text tone="muted">{t("Você é o {n}º da lista de espera. Se alguém cancelar, a vaga é sua e você recebe um aviso.", { n: mine.waitlist_position ?? 1 })}</Text>
      ) : mine?.status === "booked" ? (
        <Text tone="muted">{t("Sua vaga está garantida. Chegando lá, faça o check-in com o QR da aula.")}</Text>
      ) : null}
      {canCheckIn(s) && mine?.status !== "attended" && mine?.status !== "no_show" ? <CheckInPanel clubId={clubId} sessionId={s.id} onDone={onCheckedIn} /> : null}
    </View>
  );
}

/** Check-in: read the QR at the venue (the camera) or type its code. A QR from another class is refused here. */
export function CheckInPanel({ clubId, sessionId, onDone }: { clubId: string; sessionId: string; onDone: () => void }) {
  const { theme } = useTheme();
  const checkIn = useCheckIn(clubId);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const send = (value: string) => checkIn.mutate({ sessionId, code: value }, {
    onSuccess: () => { toast.success(t("Check-in feito"), t("Bom treino!")); setCode(""); onDone(); },
    onError: (e) => toast.error(e),
  });
  // A scan the API never saw gets the same pt-BR toast as an API error (a 400 the app makes itself).
  const refuse = (title: string, detail: string) => toast.error(new ApiError(400, "checkin.scan", title, detail));
  const scanned = (data: string) => {
    setScanning(false);
    const p = parseCheckIn(data);
    if (!p) { refuse(t("QR não reconhecido"), t("Use o QR de check-in mostrado na aula, ou digite o código.")); return; }
    if (p.session && p.session !== sessionId) { refuse(t("Esse QR é de outra aula"), t("Abra a aula certa em Aulas e tente de novo.")); return; }
    send(p.code);
  };
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[3] }}>
      <Text variant="titleSm" accessibilityRole="header">{t("Check-in")}</Text>
      {scanning ? <QrScanner onScan={scanned} /> : null}
      {scannerAvailable ? (
        <Button variant={scanning ? "ghost" : "primary"} icon={ScanQrCode} onPress={() => setScanning((v) => !v)}>{scanning ? t("Fechar a câmera") : t("Ler o QR da aula")}</Button>
      ) : null}
      <Field label={t("Ou digite o código")} hint={t("O código de 6 letras e números que aparece embaixo do QR.")}>
        {(a) => <Input {...a} value={code} onChangeText={(v) => setCode(v.replace(/[^A-Za-z0-9]/g, "").toUpperCase())} autoCapitalize="characters" autoCorrect={false} maxLength={10} placeholder="ABC123" />}
      </Field>
      <Button variant="secondary" disabled={code.length < 4} loading={checkIn.isPending} onPress={() => send(code)}>{t("Fazer check-in")}</Button>
    </Card>
  );
}
