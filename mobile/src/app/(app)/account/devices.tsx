/**
 * C1 · Aparelhos conectados: where the account is signed in (GET /me/sessions), this device first. Ending one or
 * all the others asks first: whoever is using them is signed out right away.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRevokeOtherSessions, useRevokeSession, useSessions } from "@/api/account";
import type { UserSession } from "@/api/types";
import { deviceName } from "@/components/account/labels";
import { ConfirmDialog, Section } from "@/components/account/parts";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { ago } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Button, Card, EmptyState, Screen, Skeleton, Text, toast } from "@/ui";
import { CircleAlert, LogOut, Monitor, Smartphone } from "@/ui/icons";

export default function DevicesScreen() {
  const { theme } = useTheme();
  const list = useSessions();
  const revoke = useRevokeSession(), others = useRevokeOtherSessions();
  const [target, setTarget] = useState<UserSession | "others" | null>(null);
  const items = list.data ?? [];
  const n = items.filter((s) => !s.current).length;
  const close = () => setTarget(null);
  const confirm = () => {
    if (target === "others") others.mutate(undefined, { onSuccess: (r) => { close(); toast.success(t("Saímos dos outros aparelhos"), tn(r.revoked, "{n} sessão encerrada.", "{n} sessões encerradas.")); }, onError: (e) => { close(); toast.error(e); } });
    else if (target) revoke.mutate(target.id, { onSuccess: () => { close(); toast.success(t("Sessão encerrada")); }, onError: (e) => { close(); toast.error(e); } });
  };
  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
      <Text tone="muted">{t("Onde sua conta está aberta agora. Se não reconhecer um aparelho, encerre a sessão dele.")}</Text>
      {list.isPending ? (
        <Skeleton style={{ height: theme.space[20] * 2 }} />
      ) : list.error ? (
        <Card>
          <EmptyState icon={CircleAlert} title={list.error instanceof ApiError ? list.error.title : t("Algo deu errado")}
            action={<Button variant="secondary" loading={list.isFetching} onPress={() => void list.refetch()}>{t("Tentar de novo")}</Button>}>
            {list.error instanceof ApiError ? list.error.detail : t("Tente novamente em instantes.")}
          </EmptyState>
        </Card>
      ) : (
        <Section title={tn(items.length, "{n} aparelho", "{n} aparelhos")} padded={false}>
          {items.map((s, i) => {
            const I = s.kind === "mobile" ? Smartphone : Monitor;
            const name = deviceName(s);
            return (
              <View key={s.id} style={[styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[3], paddingVertical: theme.space[3], borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: theme.color.lineSubtle }]}>
                <View style={[styles.center, { width: theme.space[10], height: theme.space[10], borderRadius: theme.radius.md, backgroundColor: theme.color.soft }]}>
                  <I size={theme.size.iconMd} color={theme.color.fgMuted} aria-hidden />
                </View>
                <View style={[styles.flex, { gap: theme.space["0.5"] }]}>
                  <Text variant="labelMd" numberOfLines={1}>{name}</Text>
                  {s.current ? <Badge tone="success">{t("Este aparelho")}</Badge> : <Text variant="bodySm" tone="muted">{t("Ativo {a}", { a: ago(s.last_seen_at) })}</Text>}
                </View>
                {!s.current && <Button variant="ghost" size="sm" accessibilityLabel={t("Encerrar {d}", { d: name })} onPress={() => setTarget(s)}>{t("Encerrar")}</Button>}
              </View>
            );
          })}
        </Section>
      )}
      {n > 0 && <Button variant="secondary" icon={LogOut} onPress={() => setTarget("others")}>{t("Sair de todos os outros")}</Button>}
      <ConfirmDialog open={!!target} onOpenChange={(v) => !v && close()} onConfirm={confirm} loading={revoke.isPending || others.isPending}
        title={target === "others" ? t("Sair de todos os outros aparelhos?") : t("Encerrar a sessão em {d}?", { d: target ? deviceName(target) : "" })}
        description={target === "others"
          ? tn(n, "{n} aparelho vai precisar entrar de novo. Este continua conectado.", "{n} aparelhos vão precisar entrar de novo. Este continua conectado.")
          : t("Quem estiver usando esse aparelho vai precisar entrar de novo.")}
        confirmLabel={target === "others" ? t("Sair dos outros") : t("Encerrar sessão")} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
});
