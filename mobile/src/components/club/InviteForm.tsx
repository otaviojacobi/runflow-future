/**
 * Invite one person at a time (D-023, the web's InviteForm): e-mail + optional full name; owners also choose student or
 * trainer. Runflow e-mails a personal link valid for 7 days that only that e-mail can use. The form clears for the
 * next person and lists who was invited. Used by the create-club wizard (A5); Membros (O2, X15) adds groups.
 */
import { useRef, useState, type ComponentRef } from "react";
import { StyleSheet, View, type TextInput } from "react-native";
import { useCreateInvite } from "@/api/clubs";
import type { Club } from "@/api/types";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Field, Input, Segmented, Text, toast } from "@/ui";
import { Check, Mail, Send } from "@/ui/icons";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function InviteForm({ club, onSent }: { club: Pick<Club, "id" | "trainer_label">; onSent?: (email: string) => void }) {
  const { theme } = useTheme();
  const { role: myRole } = useClub();
  const create = useCreateInvite(club.id);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"student" | "trainer">("student");
  const [sent, setSent] = useState<{ email: string; name: string; role: "student" | "trainer" }[]>([]);
  const clean = email.trim().toLowerCase();
  const typo = clean.length > 3 && !EMAIL.test(clean);
  const err = create.error instanceof ApiError ? create.error : null;
  const trainer = club.trainer_label === "professor" ? t("Professor(a)") : t("Treinador(a)");
  const send = () => {
    if (!EMAIL.test(clean)) return;
    create.mutate({ email: clean, role, name: name.trim() || undefined }, {
      onSuccess: () => {
        toast.success(t("Convite enviado para {email}", { email: clean }), t("Vale por 7 dias."));
        setSent((s) => [{ email: clean, name: name.trim(), role }, ...s]);
        onSent?.(clean);
        setEmail(""); setName(""); create.reset();
        emailRef.current?.focus();
      },
    });
  };
  return (
    <View style={{ gap: theme.space[4] }}>
      {myRole === "owner" && (
        <Segmented<"student" | "trainer"> label={t("Convidar como")} value={role} onChange={setRole} style={styles.start}
          options={[{ value: "student", label: t("Aluno(a)") }, { value: "trainer", label: trainer }]} />
      )}
      <Field label={t("E-mail")} error={typo ? t("Confira o e-mail, como nome@email.com.") : err && !err.fieldError("name") ? `${err.title}. ${err.detail}` : null}>
        {(a) => <Input {...a} ref={emailRef} value={email} onChangeText={(v) => { setEmail(v); if (create.error) create.reset(); }} placeholder="nome@email.com"
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="off" returnKeyType="send" onSubmitEditing={send} />}
      </Field>
      <Field label={t("Nome completo")} optional hint={t("Usado na saudação do e-mail.")} error={err?.fieldError("name")}>
        {(a) => <Input {...a} value={name} onChangeText={setName} placeholder={t("Ex.: Ana Souza")} autoCapitalize="words" autoComplete="off" />}
      </Field>
      <View style={[styles.row, { gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: theme.color.sunken }]}>
        <Mail size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden style={{ marginTop: theme.space["0.5"] }} />
        <Text variant="bodySm" tone="muted" style={styles.flex}>{t("O convite chega por e-mail, vale 7 dias e só funciona com o e-mail convidado.")}</Text>
      </View>
      <Button icon={Send} block disabled={!EMAIL.test(clean)} loading={create.isPending} onPress={send}>{t("Enviar convite")}</Button>
      {sent.length > 0 && (
        <View accessibilityLiveRegion="polite" style={{ gap: theme.space["1.5"], paddingTop: theme.space[3], borderTopWidth: 1, borderTopColor: theme.color.lineSubtle }}>
          <Text variant="labelSm" tone="muted">{t("Convidados agora")}</Text>
          {sent.map((s) => (
            <View key={s.email} style={[styles.row, styles.center, { gap: theme.space[2] }]}>
              <Check size={theme.size.iconSm} color={theme.color.success.text} aria-hidden />
              <Text variant="bodySm" numberOfLines={1} style={styles.flex}>{s.name ? `${s.name} · ${s.email}` : s.email}</Text>
              <Text variant="caption" tone="muted">{s.role === "trainer" ? trainer : t("Aluno(a)")}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  center: { alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
});
