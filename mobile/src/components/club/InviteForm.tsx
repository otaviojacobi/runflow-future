/**
 * Invite one person at a time (D-023, the web's InviteForm): e-mail + optional full name; owners also choose student or
 * trainer. Runflow e-mails a personal link valid for 7 days that only that e-mail can use. The form clears for the
 * next person and lists who was invited. Students can join groups right away (none exist yet in the create-club
 * wizard, A5; Membros, O2, has them).
 */
import { useRef, useState, type ComponentRef } from "react";
import { Pressable, StyleSheet, View, type TextInput } from "react-native";
import { useCreateInvite } from "@/api/clubs";
import { useGroups } from "@/api/staff";
import type { Club } from "@/api/types";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Field, Input, Segmented, Text, toast } from "@/ui";
import { Check, Mail, Send } from "@/ui/icons";
import { weight } from "@/theme/theme";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function InviteForm({ club, onSent }: { club: Pick<Club, "id" | "trainer_label">; onSent?: (email: string) => void }) {
  const { theme } = useTheme();
  const { role: myRole } = useClub();
  const create = useCreateInvite(club.id);
  const groups = useGroups(club.id);
  const [groupIds, setGroupIds] = useState<string[]>([]);
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
    create.mutate({ email: clean, role, name: name.trim() || undefined, group_ids: role === "student" && groupIds.length ? groupIds : undefined }, {
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
      {role === "student" && (groups.data?.length ?? 0) > 0 && (
        <View style={{ gap: theme.space[2] }}>
          <Text variant="labelSm">{t("Entrar nos grupos")} <Text variant="labelSm" tone="muted">({t("opcional")})</Text></Text>
          <View style={[styles.wrap, { gap: theme.space[2] }]}>
            {groups.data!.map((g) => {
              const on = groupIds.includes(g.id);
              const c = theme.color;
              return (
                <Pressable key={g.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={g.name}
                  onPress={() => setGroupIds(on ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])}
                  style={({ pressed }) => [styles.chip, {
                    minHeight: theme.size.touchMin, paddingHorizontal: theme.space[4], borderRadius: theme.radius.full, borderWidth: on ? 2 : 1,
                    borderColor: on ? c.brand.ring : c.line, backgroundColor: on ? c.brand.subtle : pressed ? c.soft : c.surface,
                  }]}>
                  <Text variant="labelSm" color={on ? c.brand.subtleFg : c.fgMuted} style={{ fontWeight: weight("semibold") }}>{g.name}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}
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
  wrap: { flexDirection: "row", flexWrap: "wrap" },
  chip: { flexDirection: "row", alignItems: "center", justifyContent: "center" },
});
