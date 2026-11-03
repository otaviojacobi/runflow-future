/**
 * C1 · Relógios e apps (the web's ProviderConnections): Strava's status, its last sync and disconnecting (which deletes
 * what came from Strava and the sharing consent, root.md §5); Garmin "em breve". Connecting Strava inside the app
 * comes with X5 (Strava's mobile authorization): until then "Conectar com Strava" opens Minha conta on the web.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useConnections, useDisconnect } from "@/api/account";
import { ConfirmDialog } from "@/components/account/parts";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { ago } from "@/lib/format";
import { openOnWeb } from "@/lib/web";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Button, Card, EmptyState, Screen, Skeleton, Text, toast, type Icon } from "@/ui";
import { Activity, Check, CircleAlert, ExternalLink, Unlink, Watch } from "@/ui/icons";

function ProviderIcon({ icon: I }: { icon: Icon }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.center, { width: theme.space[12], height: theme.space[12], borderRadius: theme.radius.md, backgroundColor: theme.color.soft }]}>
      <I size={theme.size.iconLg} color={theme.color.fg} aria-hidden />
    </View>
  );
}

export default function ConnectionsScreen() {
  const { theme } = useTheme();
  const conns = useConnections();
  const disconnect = useDisconnect();
  const [confirm, setConfirm] = useState(false);
  const strava = conns.data?.find((c) => c.provider === "strava")?.connection ?? null;
  const run = () => disconnect.mutate("strava", {
    onSuccess: () => { setConfirm(false); toast.success(t("Strava desconectado"), t("Apagamos os dados que vieram do Strava.")); },
    onError: (e) => { setConfirm(false); toast.error(e); },
  });
  return (
    <Screen refreshing={conns.isRefetching} onRefresh={() => void conns.refetch()}>
      <Text tone="muted">{t("Seus treinos chegam sozinhos. Desconectar apaga os dados importados.")}</Text>
      {conns.isPending ? (
        <Skeleton style={{ height: theme.space[20] + theme.space[4] }} />
      ) : conns.error ? (
        <Card>
          <EmptyState icon={CircleAlert} title={conns.error instanceof ApiError ? conns.error.title : t("Algo deu errado")}
            action={<Button variant="secondary" loading={conns.isFetching} onPress={() => void conns.refetch()}>{t("Tentar de novo")}</Button>}>
            {conns.error instanceof ApiError ? conns.error.detail : t("Tente novamente em instantes.")}
          </EmptyState>
        </Card>
      ) : (
        <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
          <View style={[styles.row, { gap: theme.space[4] }]}>
            <ProviderIcon icon={Activity} />
            <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
              <View style={[styles.row, { gap: theme.space[2] }]}>
                <Text variant="labelMd">Strava</Text>
                {strava && <Badge tone="success" icon={Check}>{t("Conectado")}</Badge>}
              </View>
              <Text variant="bodySm" tone="muted">
                {strava ? t("Última sincronização {when}.", { when: strava.last_sync_at ? ago(strava.last_sync_at) : t("agora") }) : t("Seus treinos chegam sozinhos quando você termina a atividade.")}
              </Text>
            </View>
          </View>
          {strava ? (
            <Button variant="secondary" icon={Unlink} onPress={() => setConfirm(true)}>{t("Desconectar")}</Button>
          ) : (
            <View style={{ gap: theme.space[2] }}>
              <Button icon={ExternalLink} accessibilityHint={t("Abre no Runflow pela web")} onPress={() => void openOnWeb("/account#connections")}>{t("Conectar com Strava")}</Button>
              <Text variant="caption" tone="muted">{t("Por enquanto a conexão é feita no Runflow pelo navegador. Depois, tudo chega aqui também.")}</Text>
            </View>
          )}
        </Card>
      )}
      <Card style={[styles.row, { gap: theme.space[4], padding: theme.space[4], backgroundColor: theme.color.sunken }]}>
        <ProviderIcon icon={Watch} />
        <View style={styles.flex}>
          <Text variant="labelMd">Garmin</Text>
          <Text variant="bodySm" tone="muted">{t("Em breve: treinos direto no relógio.")}</Text>
        </View>
        <Badge>{t("Em breve")}</Badge>
      </Card>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} loading={disconnect.isPending} onConfirm={run}
        title={t("Desconectar o Strava?")}
        description={t("Apagamos as atividades que vieram do Strava e os clubes deixam de vê-las. Seus feedbacks e comentários ficam.")}
        confirmLabel={t("Desconectar")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
});
