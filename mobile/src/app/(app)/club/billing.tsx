/**
 * O4 · Plano e cobrança (owner; the web's screens/owner/Billing.tsx): the plan and its seats (D-043), every plan from
 * `GET /public/plans`, subscribing (Stripe Checkout) and Pro ⇄ Max, managing the subscription (Stripe's portal),
 * invoices, and the way out of a failed payment or a frozen club. Stripe's pages open in the browser and the plan is
 * refetched on return; the mock's simulated pages are sheets here (components/billing/MockStripe.tsx).
 */
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { refreshBilling, useChangePlan, useCheckout, useInvoices, usePlans, usePortal, useSubscription } from "@/api/billing";
import type { Invoice, PaidPlan, PlanSpec, Subscription } from "@/api/types";
import { MockCheckoutSheet, MockPortalSheet } from "@/components/billing/MockStripe";
import { extraText, featuresOf, fits, price, seatsText } from "@/components/billing/plans";
import { SeatMeter } from "@/components/billing/Seats";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { fullDate, localDate, money } from "@/lib/format";
import type { Tone } from "@/theme/theme";
import { useTheme } from "@/theme/ThemeProvider";
import { Badge, Button, Card, Screen, Skeleton, Text, toast } from "@/ui";
import { ArrowRightLeft, Building, Check, CreditCard, ExternalLink, Receipt, Snowflake, Sparkles, TriangleAlert, UserCog, Users } from "@/ui/icons";

const STATUS: Record<Subscription["status"], { label: string; tone: Tone }> = {
  active: { label: "Ativo", tone: "success" }, trialing: { label: "Em teste", tone: "info" }, past_due: { label: "Pagamento pendente", tone: "danger" }, canceled: { label: "Cancelado", tone: "neutral" },
};
const INVOICE: Record<Invoice["status"], { label: string; tone: Tone }> = {
  paid: { label: "Paga", tone: "success" }, open: { label: "Em aberto", tone: "warning" }, draft: { label: "Rascunho", tone: "neutral" }, void: { label: "Anulada", tone: "neutral" }, uncollectible: { label: "Não paga", tone: "danger" },
};
const day = (iso: string) => fullDate(localDate(iso));
/** The mock answers its own in-app pages (`/dev/stripe/*`); Stripe answers https URLs. */
const isMock = (url: string) => url.startsWith("/");

export default function BillingScreen() {
  const { theme } = useTheme();
  const { club, me } = useClub();
  const sub = useSubscription(club?.id);
  const plans = usePlans();
  const invoices = useInvoices(club?.id);
  const checkout = useCheckout(club?.id ?? "");
  const change = useChangePlan(club?.id ?? "");
  const portal = usePortal(club?.id ?? "");
  const [mockPlan, setMockPlan] = useState<PaidPlan | null>(null);
  const [mockPortal, setMockPortal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  if (!club) return null;
  const s = sub.data;
  const catalog = plans.data;
  const current = catalog?.plans.find((p) => p.id === s?.plan);

  /** Stripe's page in the browser; whatever happened there arrives by webhook, so refetch when the person is back. */
  const openStripe = async (url: string) => {
    await WebBrowser.openBrowserAsync(url);
    refreshBilling(club.id);
  };
  const subscribe = (plan: PaidPlan) => checkout.mutate(plan, {
    onSuccess: (r) => (isMock(r.checkout_url) ? setMockPlan(plan) : void openStripe(r.checkout_url)),
    onError: toast.error,
  });
  const switchTo = (p: PlanSpec) => change.mutate(p.id as PaidPlan, {
    onSuccess: () => toast.success(t("Plano alterado para o {plan}", { plan: p.name }), t("A diferença é ajustada na próxima fatura.")),
    onError: toast.error,
  });
  const manage = () => portal.mutate(undefined, {
    onSuccess: (r) => (isMock(r.portal_url) ? setMockPortal(true) : void openStripe(r.portal_url)),
    onError: toast.error,
  });
  const busy = checkout.isPending || change.isPending || portal.isPending;
  const refresh = async () => { setRefreshing(true); await Promise.all([sub.refetch(), invoices.refetch()]); setRefreshing(false); };

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {/* The back bar says "Plano e cobrança". */}
      <Text tone="muted">{t("Cada plano inclui vagas para treinadores e alunos ativos. Membros suspensos não contam.")}</Text>
      {!s || !catalog || !current ? <Skeleton style={{ height: theme.space[20] * 2 }} /> : (
        <>
          <Notice s={s} plan={current} onManage={manage} busy={portal.isPending} />
          <CurrentPlan s={s} plan={current} onManage={manage} busy={busy} />
          <Text variant="titleMd" accessibilityRole="header">{t("Planos")}</Text>
          {catalog.plans.map((p) => <PlanCard key={p.id} p={p} s={s} busy={busy} onSubscribe={subscribe} onChange={switchTo} />)}
          <Card style={{ padding: theme.space[4], gap: theme.space[2] }}>
            <Text variant="titleMd">{t("Enterprise")}</Text>
            <Text variant="metricMd">{t("Licença anual")}</Text>
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <Users size={theme.size.iconSm} color={theme.color.fg} aria-hidden />
              <Text variant="labelSm">{t("Sem limite de vagas")}</Text>
            </View>
            <Features items={[t("Roda no servidor da sua empresa"), t("Mesmo app, seus dados")]} />
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <Building size={theme.size.iconSm} color={theme.color.fgMuted} aria-hidden />
              <Text variant="bodySm" tone="muted">{t("Fale com o time Runflow")}</Text>
            </View>
          </Card>
          <Invoices items={invoices.data} />
        </>
      )}
      <MockCheckoutSheet clubId={club.id} clubName={club.name} email={me?.user.email ?? ""} plan={mockPlan}
        onClose={(paid) => {
          setMockPlan(null);
          if (paid) toast.success(t("Assinatura confirmada"), t("O novo plano já está valendo para o clube."));
          else toast.info(t("Assinatura não concluída"), t("Nada foi cobrado. Você pode tentar de novo quando quiser."));
        }} />
      <MockPortalSheet clubId={club.id} clubName={club.name} open={mockPortal} onOpenChange={setMockPortal} />
    </Screen>
  );
}

function Features({ items }: { items: string[] }) {
  const { theme } = useTheme();
  return (
    <View style={{ gap: theme.space["1.5"] }}>
      {items.map((f) => (
        <View key={f} style={[styles.row, styles.top, { gap: theme.space[2] }]}>
          <Check size={theme.size.iconSm} color={theme.color.success.text} aria-hidden style={{ marginTop: theme.space["0.5"] }} />
          <Text variant="bodySm" tone="muted" style={styles.flex}>{f}</Text>
        </View>
      ))}
    </View>
  );
}

/** A failed payment (grace period) or a frozen club: what happened and the one way out. */
function Notice({ s, plan, onManage, busy }: { s: Subscription; plan: PlanSpec; onManage: () => void; busy: boolean }) {
  const { theme } = useTheme();
  if (s.frozen) {
    const unpaid = s.status === "past_due";
    const i = theme.color.info;
    return (
      <View accessibilityRole="alert" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: i.border, backgroundColor: i.subtle }}>
        <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
          <Snowflake size={theme.size.iconMd} color={i.subtleFg} aria-hidden />
          <View style={[styles.flex, { gap: theme.space[1] }]}>
            <Text variant="labelMd" color={i.subtleFg}>{t("Clube congelado")}</Text>
            <Text variant="bodySm" color={i.subtleFg}>{unpaid
              ? t("O pagamento do {plan} está pendente. A equipe só consegue ver o clube até regularizar; os alunos continuam usando normalmente.", { plan: plan.name })
              : t("O clube tem mais membros do que o plano {plan} permite. Assine um plano maior para voltar a usar o clube; os alunos continuam usando normalmente.", { plan: plan.name })}</Text>
          </View>
        </View>
        {unpaid && <Button icon={CreditCard} loading={busy} onPress={onManage}>{t("Atualizar cartão")}</Button>}
      </View>
    );
  }
  if (s.status !== "past_due") return null;
  const d = theme.color.danger;
  return (
    <View accessibilityRole="alert" style={{ gap: theme.space[3], padding: theme.space[4], borderRadius: theme.radius.lg, borderWidth: 1, borderColor: d.border, backgroundColor: d.subtle }}>
      <View style={[styles.row, styles.top, { gap: theme.space[3] }]}>
        <TriangleAlert size={theme.size.iconMd} color={d.subtleFg} aria-hidden />
        <Text variant="bodySm" color={d.subtleFg} style={styles.flex}>{s.grace_until
          ? t("O último pagamento não foi aprovado. Atualize o cartão até {d} para o clube não ser congelado.", { d: day(s.grace_until) })
          : t("O último pagamento não foi aprovado. Atualize o cartão para manter o plano.")}</Text>
      </View>
      <Button variant="danger" icon={CreditCard} loading={busy} onPress={onManage}>{t("Atualizar cartão")}</Button>
    </View>
  );
}

function CurrentPlan({ s, plan, onManage, busy }: { s: Subscription; plan: PlanSpec; onManage: () => void; busy: boolean }) {
  const { theme } = useTheme();
  const st = STATUS[s.status];
  const icon = (I: typeof Users) => <I size={theme.size.iconSm} color={theme.color.fg} aria-hidden />;
  return (
    <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
      <View style={{ gap: theme.space[1] }}>
        <Text variant="bodySm" tone="muted">{t("Seu plano")}</Text>
        <View style={[styles.wrap, { gap: theme.space[2] }]}>
          <Text variant="displaySm">{plan.name}</Text>
          <Badge tone={st.tone}>{t(st.label)}</Badge>
          {s.frozen && <Badge tone="info">{t("Congelado")}</Badge>}
        </View>
        <Text tone="muted">{s.plan === "free" ? t("Grátis para sempre") : t("{price} por mês", { price: money(s.monthly_cents) })}</Text>
        {s.plan !== "free" && s.current_period_end ? (
          s.cancel_at_period_end
            ? <Text variant="bodySm" color={theme.color.warning.text}>{t("Cancelado: o {plan} vale até {d}. Depois o clube volta para o Free; ninguém é removido.", { plan: plan.name, d: day(s.current_period_end) })}</Text>
            : <Text variant="bodySm" tone="muted">{t("Renova em {d}", { d: day(s.current_period_end) })}</Text>
        ) : null}
        {s.plan !== "free" && (
          <Button variant="secondary" icon={CreditCard} loading={busy} style={[styles.start, { marginTop: theme.space[2] }]} onPress={onManage}>
            {s.cancel_at_period_end ? t("Retomar assinatura") : t("Gerenciar assinatura")}
          </Button>
        )}
      </View>
      <View style={{ gap: theme.space[4], padding: theme.space[4], borderRadius: theme.radius.lg, backgroundColor: theme.color.sunken }}>
        <SeatMeter label={t("Alunos ativos")} icon={icon(Users)} used={s.active_students} limit={s.student_limit} included={s.included_students} each={plan.extra?.student_cents}
          one="Ainda cabe {n} aluno neste plano." other="Ainda cabem {n} alunos neste plano." />
        <SeatMeter label={t("Treinadores")} icon={icon(UserCog)} used={s.active_trainers} limit={s.trainer_limit} included={s.included_trainers} each={plan.extra?.trainer_cents}
          one="Ainda cabe {n} treinador neste plano." other="Ainda cabem {n} treinadores neste plano." />
        <Text variant="caption" tone="muted">{t("O responsável pelo clube não conta. Membros suspensos liberam a vaga.")}</Text>
      </View>
    </Card>
  );
}

function PlanCard({ p, s, busy, onSubscribe, onChange }: { p: PlanSpec; s: Subscription; busy: boolean; onSubscribe: (plan: PaidPlan) => void; onChange: (p: PlanSpec) => void }) {
  const { theme } = useTheme();
  const current = p.id === s.plan;
  const paid = s.plan !== "free" && s.status !== "canceled";
  const fit = fits(p, s);
  const extra = extraText(p);
  return (
    <Card edge={p.id === "pro" ? "brand" : undefined} style={[{ padding: theme.space[4], gap: theme.space[3] }, current && { borderWidth: 2, borderColor: theme.color.brand.ring }]}>
      <View style={styles.between}>
        <Text variant="titleMd">{p.name}</Text>
        {current && <Badge tone="brand">{t("Seu plano")}</Badge>}
      </View>
      <Text variant="metricLg">{price(p.price_cents)}{p.price_cents > 0 ? <Text variant="bodyMd" tone="muted">{t("/mês")}</Text> : null}</Text>
      <View style={[styles.row, styles.top, { gap: theme.space[2] }]}>
        <Users size={theme.size.iconSm} color={theme.color.fg} aria-hidden style={{ marginTop: theme.space["0.5"] }} />
        <Text variant="labelSm" style={styles.flex}>{seatsText(p)}</Text>
      </View>
      {extra ? <Text variant="bodySm" tone="muted">{extra}</Text> : null}
      <Features items={featuresOf(p.id)} />
      {!current && p.id !== "free" && (paid
        ? <Button variant="secondary" icon={ArrowRightLeft} loading={busy} disabled={!fit} onPress={() => onChange(p)}>{t("Mudar para o {plan}", { plan: p.name })}</Button>
        : <Button icon={Sparkles} loading={busy} disabled={!fit} onPress={() => onSubscribe(p.id as PaidPlan)}>{t("Assinar {plan}", { plan: p.name })}</Button>)}
      {!current && !fit ? <Text variant="caption" tone="muted">{t("O clube tem mais membros do que este plano comporta.")}</Text> : null}
    </Card>
  );
}

function Invoices({ items }: { items?: Invoice[] }) {
  const { theme } = useTheme();
  const c = theme.color;
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="titleMd" accessibilityRole="header">{t("Faturas")}</Text>
      <Card style={{ paddingVertical: theme.space[1] }}>
        {!items ? <Skeleton style={{ height: theme.space[20], margin: theme.space[4] }} /> : items.length === 0 ? (
          <View style={[styles.row, { gap: theme.space[2], padding: theme.space[4] }]}>
            <Receipt size={theme.size.iconMd} color={c.fgMuted} aria-hidden />
            <Text tone="muted" style={styles.flex}>{t("Nenhuma fatura ainda. No plano Free nada é cobrado.")}</Text>
          </View>
        ) : items.map((i, n) => (
          <View key={i.id} style={[styles.row, { gap: theme.space[3], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], borderTopWidth: n ? 1 : 0, borderTopColor: c.lineSubtle }]}>
            <View style={styles.flex}>
              <Text variant="labelMd" style={styles.tabular}>{money(i.amount_cents, i.currency)}</Text>
              <Text variant="caption" tone="muted" style={styles.tabular}>{day(i.period_start)} – {day(i.period_end)}</Text>
            </View>
            <Badge tone={INVOICE[i.status].tone}>{t(INVOICE[i.status].label)}</Badge>
            {i.hosted_url ? (
              <Button variant="ghost" size="sm" iconRight={ExternalLink} accessibilityLabel={t("Recibo de {d}", { d: day(i.created_at) })}
                onPress={() => void WebBrowser.openBrowserAsync(i.hosted_url!)}>{t("Recibo")}</Button>
            ) : null}
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
  tabular: { fontVariant: ["tabular-nums"] },
});
