/**
 * C1 · Notificações (D-045, N1), like the web's components/account/NotificationSettings: every notification lands in
 * the app's center; what a person switches is whether each kind also arrives as a push on their devices, plus
 * "Pausar tudo". Every change saves at once (optimistic). No e-mail, digest or quiet hours (D-045).
 *
 * Registering this phone for push needs the store app (X10's development build): until then the device card says so,
 * and the switches already apply to the person's other devices (the Runflow installed from the browser).
 */
import { StyleSheet, View } from "react-native";
import { usePrefs, useUpdatePrefs } from "@/api/notifications";
import type { MembershipContext, PrefsPatch } from "@/api/types";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { Card, Skeleton, Switch, Text } from "@/ui";
import { BellRing } from "@/ui/icons";
import { KIND_INFO, kindsFor } from "./labels";
import { Section } from "./parts";

export function NotificationSettings({ memberships }: { memberships: MembershipContext[] }) {
  const { theme } = useTheme();
  const prefs = usePrefs();
  const update = useUpdatePrefs();
  const p = prefs.data;
  if (!p) return <View style={{ gap: theme.space[3] }}><Skeleton style={{ height: theme.space[20] }} /><Skeleton style={{ height: theme.space[20] * 3 }} /></View>;
  const save = (v: PrefsPatch) => update.mutate(v);
  const kinds = kindsFor(memberships);
  return (
    <>
      <DevicePush />
      <Card style={{ paddingHorizontal: theme.space[4], paddingVertical: theme.space[2] }}>
        <Switch checked={p.paused} onCheckedChange={(paused) => save({ paused })} label={t("Pausar tudo")}
          description={t("Nenhuma notificação chega aos seus aparelhos até você retomar. A central do app continua recebendo tudo.")} />
      </Card>
      {kinds.length > 0 && (
        <Section title={t("Receber no aparelho")} padded={false}
          description={p.paused ? t("Pausado. Suas escolhas voltam a valer quando você retomar.") : t("Desligado, o aviso fica só na central do app.")}>
          {kinds.map((k, i) => (
            <View key={k} style={{ paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: theme.color.lineSubtle }}>
              <Switch checked={p.kinds[k]?.push ?? false} disabled={p.paused} onCheckedChange={(push) => save({ kinds: { [k]: { push } } })}
                label={t(KIND_INFO[k].label)} description={t(KIND_INFO[k].hint)} />
            </View>
          ))}
        </Section>
      )}
    </>
  );
}

/**
 * Push on this phone (the web's device card): it arrives with the store app (X10), so say so instead of a switch that
 * can't work yet. Info colors, not the club's: a red club would make a plain notice look like an error.
 */
function DevicePush() {
  const { theme } = useTheme();
  const c = theme.color.info;
  return (
    <Card style={[styles.row, { gap: theme.space[3], padding: theme.space[4], backgroundColor: c.subtle, borderColor: c.border }]}>
      <BellRing size={theme.size.iconMd} color={c.text} aria-hidden style={{ marginTop: theme.space["0.5"] }} />
      <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
        <Text variant="labelMd" color={c.subtleFg}>{t("Notificações neste aparelho")}</Text>
        <Text variant="bodySm" color={c.subtleFg}>
          {t("Chegam a este celular quando o Runflow estiver na Google Play e na App Store. Até lá, os avisos ligados abaixo chegam no Runflow instalado pelo navegador.")}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
});
