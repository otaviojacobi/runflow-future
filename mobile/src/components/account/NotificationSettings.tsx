/**
 * C1 · Notificações (D-045, N1), like the web's components/account/NotificationSettings: every notification lands in
 * the app's center; what a person switches is whether each kind also arrives as a push on their devices, plus
 * "Pausar todas as notificações". Every change saves at once (optimistic). No e-mail, digest or quiet hours (D-045).
 * Names only, no explanations (founder, 2026-11-07).
 *
 * The device switch turns push on or off for this phone (lib/push.ts, X10); a short line says why only when it can't
 * (blocked in the phone's settings, or not in this build: Expo Go, the web preview).
 */
import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { usePrefs, useUpdatePrefs } from "@/api/notifications";
import type { MembershipContext, PrefsPatch } from "@/api/types";
import { t } from "@/i18n";
import { useTheme } from "@/theme/ThemeProvider";
import { disablePush, enablePush, pushState, type PushState } from "@/lib/push";
import { Button, Card, Skeleton, Switch, Text, toast } from "@/ui";
import { KIND_LABEL, kindsFor } from "./labels";
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
        <Switch checked={p.paused} onCheckedChange={(paused) => save({ paused })} label={t("Pausar todas as notificações")} />
      </Card>
      {kinds.length > 0 && (
        <Section title={t("Receber no aparelho")} padded={false}>
          {kinds.map((k, i) => (
            <View key={k} style={{ paddingHorizontal: theme.space[3], paddingVertical: theme.space[1], borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: theme.color.lineSubtle }}>
              <Switch checked={p.kinds[k]?.push ?? false} disabled={p.paused} onCheckedChange={(push) => save({ kinds: { [k]: { push } } })}
                label={t(KIND_LABEL[k])} />
            </View>
          ))}
        </Section>
      )}
    </>
  );
}

/** Why the device switch can't be used, when it can't; nothing when it can. */
const DEVICE_NOTE: Partial<Record<PushState, string>> = {
  denied: "Bloqueadas nos ajustes do celular.",
  unsupported: "Disponível no app instalado.",
  unconfigured: "Disponível no app instalado.",
};

/** Push on this phone: one switch, on or off; blocked in the phone's settings or not possible in this build (Expo Go,
 * the web preview) leaves it off, with a short reason and, when blocked, the way to the phone's settings. */
function DevicePush() {
  const { theme } = useTheme();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushState().then(setState); }, []);
  if (!state) return null;
  const run = async (fn: () => Promise<PushState>) => {
    setBusy(true);
    try { setState(await fn()); } catch (e) { toast.error(e); } finally { setBusy(false); }
  };
  const note = DEVICE_NOTE[state];
  return (
    <Card style={{ paddingHorizontal: theme.space[4], paddingVertical: theme.space[2], gap: theme.space[2] }}>
      <Switch checked={state === "on"} disabled={busy || (state !== "on" && state !== "off")} label={t("Notificações neste aparelho")}
        description={note ? t(note) : undefined} onCheckedChange={(on) => void run(on ? enablePush : disablePush)} />
      {state === "denied" && <Button size="sm" variant="secondary" onPress={() => void Linking.openSettings()} style={[styles.start, { marginBottom: theme.space[2] }]}>{t("Abrir ajustes")}</Button>}
    </Card>
  );
}

const styles = StyleSheet.create({
  start: { alignSelf: "flex-start" },
});
