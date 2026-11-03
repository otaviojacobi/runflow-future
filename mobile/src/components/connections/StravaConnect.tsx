/**
 * "Conectar com Strava" for any screen (Atividades, Relógios e apps, the student's welcome): starts lib/strava.ts from
 * the current route; on the mock a stand-in consent sheet takes the place of Strava's page, like the web app
 * (components/account/StravaConnect.tsx there). Render `mockSheet` next to the button.
 */
import { usePathname } from "expo-router";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { t } from "@/i18n";
import { connectStrava, finishStrava } from "@/lib/strava";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Dialog, Text, toast } from "@/ui";
import { Check } from "@/ui/icons";

/** Starts the connection from the current screen; the mock's stand-in consent comes back as `mockState`. */
export function useStravaConnect(onConnected?: () => void) {
  const from = usePathname();
  const [busy, setBusy] = useState(false);
  const [mockState, setMockState] = useState<string | null>(null);
  const connect = async () => {
    setBusy(true);
    try {
      const r = await connectStrava(from);
      if (r.result === "mock") setMockState(r.state);
      else if (r.result === "connected") onConnected?.();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  const [finishing, setFinishing] = useState(false);
  const authorizeMock = async () => {
    if (!mockState) return;
    setFinishing(true);
    try {
      await finishStrava({ code: "mock-code", state: mockState });
      setMockState(null);
      onConnected?.();
    } catch {
      // finishStrava showed the API's error.
    } finally {
      setFinishing(false);
    }
  };
  const mockSheet = (
    <Dialog open={mockState !== null} onOpenChange={(v) => { if (!v) setMockState(null); }} title={t("Autorizar o Runflow no Strava")}
      description={t("Simulação: no app real, esta é a página do Strava.")}
      footer={<>
        <Button variant="secondary" size="lg" onPress={() => setMockState(null)}>{t("Cancelar")}</Button>
        <Button size="lg" loading={finishing} onPress={() => void authorizeMock()} style={styles.flex}>{t("Autorizar")}</Button>
      </>}>
      <MockScopes />
    </Dialog>
  );
  return { connect, busy, mockSheet };
}

function MockScopes() {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View style={{ gap: theme.space[2] }}>
      {[t("Ler suas atividades, inclusive as privadas"), t("Ler seu perfil público")].map((s) => (
        <View key={s} style={[styles.row, { gap: theme.space[2] }]}>
          <Check size={theme.size.iconSm} color={c.success.text} aria-hidden />
          <Text variant="bodySm" tone="muted" style={styles.flex}>{s}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});
