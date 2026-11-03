/** C1 · Notificações (D-032): what reaches each person and how. Per kind: the app center, the phone, e-mail (off, right
 * away or a daily summary); pause everything; quiet hours; staff can limit feedback and comments to their groups. */
import { BellOff, BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { usePublicConfig } from "@/api/auth";
import { useGroups } from "@/api/members";
import { usePrefs, useUpdatePrefs } from "@/api/account";
import type { EmailMode, KindPref, MembershipContext, NotificationKind, NotificationPrefs } from "@/api/types";
import { t } from "@/i18n";
import { type DevicePush as DevicePushState, devicePushState, disableDevicePush, enableDevicePush, refreshDevicePush } from "@/lib/push";
import { Button, Field, Input, Select, Skeleton, Switch, cn, toast } from "@/ui";

const INFO: Record<NotificationKind, { label: string; hint: string }> = {
  workout_assigned: { label: "Treino novo", hint: "Um treino entrou na sua agenda" },
  workout_changed: { label: "Treino alterado", hint: "Mudou de dia ou de conteúdo" },
  week_released: { label: "Semana liberada", hint: "Os treinos da semana ficaram disponíveis" },
  comment: { label: "Comentários", hint: "Respostas nos treinos" },
  message: { label: "Mensagens", hint: "Conversas no app" },
  announcement: { label: "Mural", hint: "Avisos do clube" },
  feedback: { label: "Feedbacks dos alunos", hint: "Um aluno registrou ou comentou um treino" },
  member_joined: { label: "Novos membros", hint: "Alguém entrou no clube" },
  billing: { label: "Plano e cobrança", hint: "Limite de alunos e avisos do plano" },
};
const STUDENT: NotificationKind[] = ["week_released", "workout_assigned", "workout_changed", "comment", "message", "announcement"];
const STAFF: NotificationKind[] = ["feedback", "comment", "message", "member_joined"];
const EMAIL: { value: EmailMode; label: string }[] = [{ value: "off", label: "Sem e-mail" }, { value: "instant", label: "E-mail na hora" }, { value: "digest", label: "Resumo diário" }];

/** The kinds this person can receive, by the roles they hold. */
function kindsFor(memberships: MembershipContext[]): NotificationKind[] {
  const roles = new Set(memberships.map((m) => m.membership.role));
  const out: NotificationKind[] = [];
  if (roles.has("student")) out.push(...STUDENT);
  if (roles.has("trainer") || roles.has("owner")) out.push(...STAFF);
  if (roles.has("owner")) out.push("billing");
  return [...new Set(out)];
}

export function NotificationSettings({ memberships }: { memberships: MembershipContext[] }) {
  const prefs = usePrefs();
  const update = useUpdatePrefs();
  const p = prefs.data;
  if (!p) return <Skeleton className="h-64" />;
  const save = (v: Parameters<typeof update.mutate>[0]) => update.mutate(v, { onError: toast.error });
  const setKind = (k: NotificationKind, v: Partial<KindPref>) => save({ kinds: { [k]: v } });
  const kinds = kindsFor(memberships);
  const digest = kinds.some((k) => p.kinds[k]?.email === "digest");
  return (
    <div className="grid gap-5">
      <DevicePush />
      <Switch checked={p.paused} onCheckedChange={(paused) => save({ paused })} label={t("Pausar avisos")}
        description={t("Nada no celular nem por e-mail até você voltar. A central do app continua mostrando tudo.")} />
      <ul className={cn("grid divide-y divide-line-subtle rounded-lg border border-line", p.paused && "opacity-60")}>
        {kinds.map((k) => <KindRow key={k} kind={k} pref={p.kinds[k]} onChange={(v) => setKind(k, v)} />)}
      </ul>
      <div className="grid gap-4 sm:grid-cols-2">
        {digest && (
          <Field label={t("Resumo diário às")} hint={t("Horário de Brasília.")}>{(id, d) => (
            <Select id={id} aria-describedby={d} value={p.digest_hour} onChange={(e) => save({ digest_hour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, "0")}:00`}</option>)}
            </Select>
          )}</Field>
        )}
        <QuietHours p={p} onSave={(quiet_start, quiet_end) => save({ quiet_start, quiet_end })} />
      </div>
      {p.groups.map((g) => {
        const m = memberships.find((x) => x.membership.id === g.membership_id);
        return m ? <GroupFilter key={g.membership_id} clubId={g.club_id} clubName={m.club.name} groupIds={g.group_ids} onSave={(group_ids) => save({ groups: [{ club_id: g.club_id, group_ids }] })} /> : null;
      })}
    </div>
  );
}

const DEVICE_TEXT: Record<DevicePushState, string> = {
  on: "Ativas neste aparelho: os avisos marcados com “Celular” chegam aqui.",
  off: "Receba os avisos marcados com “Celular” como notificação deste aparelho.",
  denied: "Bloqueadas no navegador. Libere as notificações nas configurações do site e tente de novo.",
  install: "No iPhone, adicione o Runflow à Tela de Início e abra por lá para receber notificações.",
  unsupported: "Este navegador não mostra notificações do Runflow.",
  unavailable: "Notificações no aparelho ainda não estão disponíveis aqui.",
};

/** Push on this device (S7b): its own switch, separate from the per-kind choices. */
function DevicePush() {
  const config = usePublicConfig();
  const key = config.data?.push_public_key;
  const [state, setState] = useState<DevicePushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (config.isPending) return;
    let live = true;
    devicePushState(key).then((s) => { if (!live) return; setState(s); if (s === "on") void refreshDevicePush(); });
    return () => { live = false; };
  }, [key, config.isPending]);
  if (!state) return null;
  const run = async (fn: () => Promise<DevicePushState>) => {
    setBusy(true);
    try { setState(await fn()); } catch { toast.error(t("Não foi possível mudar as notificações deste aparelho.")); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line p-4">
      <BellRing aria-hidden className="size-5 shrink-0 text-fg-muted" />
      <div className="grid min-w-0 flex-1 basis-56 gap-0.5">
        <p className="font-semibold">{t("Notificações neste aparelho")}</p>
        <p className="text-sm text-fg-muted">{t(DEVICE_TEXT[state])}</p>
      </div>
      {state === "off" && key && <Button loading={busy} onClick={() => run(() => enableDevicePush(key))}>{t("Ativar")}</Button>}
      {state === "on" && <Button variant="secondary" loading={busy} onClick={() => run(async () => { await disableDevicePush(); return "off"; })}>{t("Desativar")}</Button>}
    </div>
  );
}

function KindRow({ kind, pref, onChange }: { kind: NotificationKind; pref: KindPref; onChange: (v: Partial<KindPref>) => void }) {
  const info = INFO[kind];
  const chip = (on: boolean, label: string, flip: () => void) => (
    <button type="button" aria-pressed={on} onClick={flip}
      className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold", on ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{label}</button>
  );
  return (
    <li className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0"><div className="font-semibold">{t(info.label)}</div><div className="text-sm text-fg-muted">{t(info.hint)}</div></div>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("Como receber: {kind}", { kind: t(info.label) })}>
        {chip(pref.app, t("No app"), () => onChange({ app: !pref.app }))}
        {chip(pref.push, t("Celular"), () => onChange({ push: !pref.push }))}
        <Select aria-label={t("E-mail: {kind}", { kind: t(info.label) })} value={pref.email} onChange={(e) => onChange({ email: e.target.value as EmailMode })} className="h-8 w-auto text-[13px]">
          {EMAIL.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}
        </Select>
      </div>
    </li>
  );
}

function QuietHours({ p, onSave }: { p: NotificationPrefs; onSave: (start: string | null, end: string | null) => void }) {
  const on = !!p.quiet_start && !!p.quiet_end;
  return (
    <div className="grid gap-2">
      <Switch checked={on} onCheckedChange={(v) => (v ? onSave("22:00", "07:00") : onSave(null, null))} label={t("Não perturbe")} description={t("Sem avisos no celular neste horário.")} />
      {on && (
        <div className="flex items-center gap-2">
          <Input type="time" aria-label={t("Início")} value={p.quiet_start ?? ""} onChange={(e) => e.target.value && onSave(e.target.value, p.quiet_end)} className="h-9 w-32" />
          <span className="text-sm text-fg-muted">{t("até")}</span>
          <Input type="time" aria-label={t("Fim")} value={p.quiet_end ?? ""} onChange={(e) => e.target.value && onSave(p.quiet_start, e.target.value)} className="h-9 w-32" />
        </div>
      )}
    </div>
  );
}

/** Staff of a big club: feedback and comment notices only about some groups' students. */
function GroupFilter({ clubId, clubName, groupIds, onSave }: { clubId: string; clubName: string; groupIds: string[]; onSave: (ids: string[]) => void }) {
  const groups = useGroups(clubId).data ?? [];
  if (!groups.length) return null;
  const all = groupIds.length === 0;
  const toggle = (id: string) => onSave(groupIds.includes(id) ? groupIds.filter((x) => x !== id) : [...groupIds, id]);
  return (
    <fieldset className="grid gap-2 rounded-lg bg-sunken p-4">
      <legend className="sr-only">{t("Feedbacks e comentários no {club}", { club: clubName })}</legend>
      <div className="flex items-center gap-2 font-semibold"><BellOff className="size-4 text-fg-muted" aria-hidden />{t("Feedbacks e comentários no {club}", { club: clubName })}</div>
      <p className="text-sm text-fg-muted">{t("Receba só sobre os alunos dos seus grupos. Os outros continuam no painel e na caixa de feedbacks.")}</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={all} onClick={() => onSave([])} className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold", all ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{t("Todos os alunos")}</button>
        {groups.map((g) => {
          const on = groupIds.includes(g.id);
          return <button key={g.id} type="button" aria-pressed={on} onClick={() => toggle(g.id)} className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold", on ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{g.name}</button>;
        })}
      </div>
    </fieldset>
  );
}
