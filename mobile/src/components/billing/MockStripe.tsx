/**
 * The mock's stand-ins for Stripe Checkout and the Billing Portal (O5; the web's /dev/stripe pages as sheets): the mock
 * answers in-app `/dev/stripe/*` paths, which the app can't open, so these sheets call the same simulation endpoints
 * (`/mock/stripe/*`). Nothing is charged. With real Stripe the app opens Stripe's own pages in the browser instead.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useInvoices, useMockCompleteCheckout, useMockPortalAction, usePlans, useSubscription, type MockPortalAction } from "@/api/billing";
import type { PaidPlan } from "@/api/types";
import { extraText, seatsText } from "@/components/billing/plans";
import { t } from "@/i18n";
import { fullDate, localDate, money } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Button, Card, Dialog, Field, Input, Skeleton, Text, toast } from "@/ui";
import { CircleX, CreditCard, FlaskConical, Lock, RotateCcw } from "@/ui/icons";

function TestBanner() {
  const { theme } = useTheme();
  const w = theme.color.warning;
  return (
    <View style={[styles.row, { gap: theme.space[2], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: w.subtle }]}>
      <FlaskConical size={theme.size.iconSm} color={w.subtleFg} aria-hidden />
      <Text variant="labelSm" color={w.subtleFg} style={styles.flex}>{t("Ambiente de testes: esta tela simula o pagamento. Nenhum valor é cobrado.")}</Text>
    </View>
  );
}

export function MockCheckoutSheet({ clubId, clubName, email, plan, onClose }: { clubId: string; clubName: string; email: string; plan: PaidPlan | null; onClose: (paid: boolean) => void }) {
  const { theme } = useTheme();
  const plans = usePlans();
  const complete = useMockCompleteCheckout(clubId);
  const [card, setCard] = useState("4242 4242 4242 4242");
  const p = plans.data?.plans.find((x) => x.id === plan);
  const extra = p ? extraText(p) : null;
  return (
    <Dialog open={plan !== null} onOpenChange={(v) => { if (!v) onClose(false); }} title={p ? t("Assinar Runflow {plan}", { plan: p.name }) : t("Assinar")}
      footer={<Button size="lg" block icon={Lock} loading={complete.isPending} disabled={!p}
        onPress={() => plan && complete.mutate(plan, { onSuccess: () => onClose(true), onError: toast.error })}>{t("Assinar")}</Button>}>
      <View style={{ gap: theme.space[4] }}>
        <TestBanner />
        {!p ? <Skeleton style={{ height: theme.space[20] }} /> : (
          <View style={{ gap: theme.space[1] }}>
            <Text variant="metricLg">{money(p.price_cents)} <Text variant="bodyMd" tone="muted">{t("por mês")}</Text></Text>
            <Text variant="labelMd">{t("Runflow {plan} · {club}", { plan: p.name, club: clubName })}</Text>
            <Text variant="bodySm" tone="muted">{seatsText(p)}{extra ? ` · ${extra}` : ""}</Text>
          </View>
        )}
        <Field label={t("E-mail")}>{(a) => <Input {...a} defaultValue={email} keyboardType="email-address" autoCapitalize="none" />}</Field>
        <Field label={t("Número do cartão")}>{(a) => <Input {...a} value={card} onChangeText={setCard} keyboardType="number-pad" />}</Field>
        <View style={[styles.row, { gap: theme.space[3] }]}>
          <Field label={t("Validade")} style={styles.flex}>{(a) => <Input {...a} defaultValue="12/34" keyboardType="number-pad" />}</Field>
          <Field label={t("CVC")} style={styles.flex}>{(a) => <Input {...a} defaultValue="123" keyboardType="number-pad" />}</Field>
        </View>
        <Text variant="caption" tone="muted">{t("Ao assinar, você autoriza a cobrança mensal até cancelar. Cancele quando quiser em Plano e cobrança.")}</Text>
      </View>
    </Dialog>
  );
}

export function MockPortalSheet({ clubId, clubName, open, onOpenChange }: { clubId: string; clubName: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { theme } = useTheme();
  const sub = useSubscription(clubId);
  const invoices = useInvoices(clubId);
  const act = useMockPortalAction(clubId);
  const s = sub.data;
  const run = (a: MockPortalAction, msg: string) => act.mutate(a, { onSuccess: () => toast.success(msg), onError: toast.error });
  const name = s ? (s.plan === "max" ? "Max" : s.plan === "pro" ? "Pro" : "Free") : "";
  const day = (iso: string) => fullDate(localDate(iso));
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Assinatura de {club}", { club: clubName })}>
      <View style={{ gap: theme.space[4] }}>
        <TestBanner />
        {!s ? <Skeleton style={{ height: theme.space[20] }} /> : (
          <>
            <Card style={{ padding: theme.space[4], gap: theme.space[2] }}>
              <View style={styles.between}>
                <Text variant="titleSm">{t("Runflow {plan}", { plan: name })}</Text>
                {s.frozen ? <Badge tone="info">{t("Congelado")}</Badge> : s.status === "past_due" ? <Badge tone="danger">{t("Pagamento pendente")}</Badge> : s.cancel_at_period_end ? <Badge tone="warning">{t("Cancelado")}</Badge> : <Badge tone="success">{t("Ativo")}</Badge>}
              </View>
              <Text variant="bodySm" tone="muted">
                {money(s.monthly_cents)} {t("por mês")}{s.current_period_end ? ` · ${s.cancel_at_period_end ? t("termina em {d}", { d: day(s.current_period_end) }) : t("renova em {d}", { d: day(s.current_period_end) })}` : ""}
              </Text>
              {s.plan !== "free" && (s.cancel_at_period_end
                ? <Button icon={RotateCcw} style={styles.start} loading={act.isPending} onPress={() => run("resume", t("Assinatura retomada"))}>{t("Retomar assinatura")}</Button>
                : <Button variant="secondary" icon={CircleX} style={styles.start} loading={act.isPending} onPress={() => run("cancel", t("Assinatura cancelada no fim do período"))}>{t("Cancelar assinatura")}</Button>)}
            </Card>
            <Card style={[styles.row, { gap: theme.space[3], padding: theme.space[4] }]}>
              <CreditCard size={theme.size.iconMd} color={theme.color.fg} aria-hidden />
              <Text variant="labelMd" style={[styles.flex, styles.tabular]}>Visa •••• 4242</Text>
              <Button variant="secondary" size="sm" onPress={() => (s.status === "past_due" ? run("pay", t("Cartão atualizado e pagamento aprovado")) : toast.success(t("Cartão atualizado")))}>{t("Atualizar cartão")}</Button>
            </Card>
            {(invoices.data?.length ?? 0) > 0 && (
              <Card style={{ padding: theme.space[4], gap: theme.space[2] }}>
                <Text variant="titleSm" accessibilityRole="header">{t("Histórico")}</Text>
                {invoices.data!.map((i) => (
                  <View key={i.id} style={styles.between}>
                    <Text variant="bodySm" style={styles.tabular}>{day(i.created_at)}</Text>
                    <Text variant="bodySm" style={styles.tabular}>{money(i.amount_cents, i.currency)}</Text>
                  </View>
                ))}
              </Card>
            )}
            <Card style={{ padding: theme.space[4], gap: theme.space[2], borderStyle: "dashed" }}>
              <View style={[styles.row, { gap: theme.space[2] }]}>
                <FlaskConical size={theme.size.iconSm} color={theme.color.fg} aria-hidden />
                <Text variant="titleSm" accessibilityRole="header">{t("Simular eventos do Stripe")}</Text>
              </View>
              <Text variant="bodySm" tone="muted">{t("Só no ambiente de testes, para ver como o app reage.")}</Text>
              <Button variant="ghost" size="sm" style={styles.start} onPress={() => run("fail_payment", t("Pagamento recusado (simulado)"))}>{t("Recusar próximo pagamento")}</Button>
              <Button variant="ghost" size="sm" style={styles.start} onPress={() => run("freeze", t("Prazo de pagamento esgotado (simulado)"))}>{t("Esgotar o prazo e congelar")}</Button>
              <Button variant="ghost" size="sm" style={styles.start} onPress={() => run("pay", t("Pagamento aprovado (simulado)"))}>{t("Aprovar pagamento")}</Button>
              <Button variant="ghost" size="sm" style={styles.start} onPress={() => run("expire", t("Período encerrado (simulado)"))}>{t("Encerrar período agora")}</Button>
            </Card>
          </>
        )}
      </View>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
  tabular: { fontVariant: ["tabular-nums"] },
});
