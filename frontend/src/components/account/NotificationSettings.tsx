/** C1 · Notificações (D-045): every notification lands in the app's center; what a person switches is whether each
 * kind also arrives as a push on their devices, plus "Pausar todas as notificações". Names only, no explanations
 * (founder, 2026-11-07). The device switch turns push on for this browser; a short line says why only when it can't. */
import { useEffect, useState } from "react";
import { usePublicConfig } from "@/api/auth";
import { usePrefs, useUpdatePrefs } from "@/api/account";
import type { MembershipContext, NotificationKind, PrefsPatch } from "@/api/types";
import { t } from "@/i18n";
import { type DevicePush as DevicePushState, devicePushState, disableDevicePush, enableDevicePush, refreshDevicePush } from "@/lib/push";
import { has } from "@/lib/features";
import { Skeleton, Switch, toast } from "@/ui";

const LABEL: Record<NotificationKind, string> = {
  workout_assigned: "Treino novo",
  workout_changed: "Treino alterado",
  week_released: "Semana liberada",
  comment: "Comentários",
  message: "Mensagens",
  announcement: "Mural",
  feedback: "Feedbacks dos alunos",
  member_joined: "Novos membros",
  billing: "Plano e cobrança",
  class_cancelled: "Aula cancelada",
  waitlist_promoted: "Vaga liberada",
  activity_synced: "Atividade sincronizada",
};
const STUDENT: NotificationKind[] = ["week_released", "workout_assigned", "workout_changed", "comment", "message", "announcement"];
const STAFF: NotificationKind[] = ["feedback", "comment", "message", "member_joined"];

/** The kinds this person can receive, by the roles they hold. */
function kindsFor(memberships: MembershipContext[]): NotificationKind[] {
  const roles = new Set(memberships.map((m) => m.membership.role));
  const out: NotificationKind[] = [];
  if (roles.has("student")) out.push(...STUDENT);
  // Aulas news only where a club the person studies at has classes (D-052).
  if (memberships.some((m) => m.membership.role === "student" && m.membership.status === "active" && has(m.club, "classes"))) out.push("class_cancelled", "waitlist_promoted");
  // Each training that arrives from Strava (D-055), where a club the person studies at uses it.
  if (memberships.some((m) => m.membership.role === "student" && m.membership.status === "active" && has(m.club, "strava"))) out.push("activity_synced");
  if (roles.has("trainer") || roles.has("owner")) out.push(...STAFF);
  if (roles.has("owner")) out.push("billing");
  return [...new Set(out)];
}

export function NotificationSettings({ memberships }: { memberships: MembershipContext[] }) {
  const prefs = usePrefs();
  const update = useUpdatePrefs();
  const p = prefs.data;
  if (!p) return <Skeleton className="h-64" />;
  const save = (v: PrefsPatch) => update.mutate(v, { onError: toast.error });
  const kinds = kindsFor(memberships);
  return (
    <div className="grid gap-5">
      <DevicePush />
      <div className="rounded-lg border border-line px-4 py-3">
        <Switch checked={p.paused} onCheckedChange={(paused) => save({ paused })} label={t("Pausar todas as notificações")} />
      </div>
      {kinds.length > 0 && (
        <section aria-labelledby="push-kinds-h" className="grid gap-2">
          <h3 id="push-kinds-h" className="rf-text-title-sm">{t("Receber no aparelho")}</h3>
          <ul className="grid divide-y divide-line-subtle rounded-lg border border-line">
            {kinds.map((k) => (
              <li key={k} className="px-4 py-3">
                <Switch checked={p.kinds[k]?.push ?? false} disabled={p.paused} onCheckedChange={(push) => save({ kinds: { [k]: { push } } })}
                  label={t(LABEL[k])} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Why the device switch can't be used, when it can't; nothing when it can. */
const DEVICE_NOTE: Partial<Record<DevicePushState, string>> = {
  denied: "Bloqueadas no navegador: libere nas configurações do site.",
  install: "No iPhone, adicione o Runflow à Tela de Início e abra por lá.",
  unsupported: "Este navegador não mostra notificações.",
  unavailable: "Ainda não disponível aqui.",
};

/** Push on this device (S7b): one switch, separate from the per-kind choices. */
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
  const note = DEVICE_NOTE[state];
  const usable = state === "on" || (state === "off" && !!key);
  return (
    <div className="rounded-lg border border-line px-4 py-3">
      <Switch checked={state === "on"} disabled={busy || !usable} label={t("Notificações neste aparelho")} description={note ? t(note) : undefined}
        onCheckedChange={(on) => run(on ? () => enableDevicePush(key!) : async () => { await disableDevicePush(); return "off"; })} />
    </div>
  );
}
