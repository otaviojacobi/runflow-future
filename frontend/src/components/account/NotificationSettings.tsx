/** C1 · Notificações (D-045): every notification lands in the app's center; what a person switches is whether each
 * kind also arrives as a push on their devices, plus "Pausar tudo". The device card turns push on for this browser. */
import { BellRing } from "lucide-react";
import { useEffect, useState } from "react";
import { usePublicConfig } from "@/api/auth";
import { usePrefs, useUpdatePrefs } from "@/api/account";
import type { MembershipContext, NotificationKind, PrefsPatch } from "@/api/types";
import { t } from "@/i18n";
import { type DevicePush as DevicePushState, devicePushState, disableDevicePush, enableDevicePush, refreshDevicePush } from "@/lib/push";
import { Button, Skeleton, Switch, toast } from "@/ui";

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
  const save = (v: PrefsPatch) => update.mutate(v, { onError: toast.error });
  const kinds = kindsFor(memberships);
  return (
    <div className="grid gap-5">
      <DevicePush />
      <div className="rounded-lg border border-line px-4 py-3">
        <Switch checked={p.paused} onCheckedChange={(paused) => save({ paused })} label={t("Pausar tudo")}
          description={t("Nenhuma notificação chega aos seus aparelhos até você retomar. A central do app continua recebendo tudo.")} />
      </div>
      {kinds.length > 0 && (
        <section aria-labelledby="push-kinds-h" className="grid gap-2">
          <div>
            <h3 id="push-kinds-h" className="rf-text-title-sm">{t("Receber no aparelho")}</h3>
            <p className="text-sm text-fg-muted">{p.paused ? t("Pausado. Suas escolhas voltam a valer quando você retomar.") : t("Desligado, o aviso fica só na central do app.")}</p>
          </div>
          <ul className="grid divide-y divide-line-subtle rounded-lg border border-line">
            {kinds.map((k) => (
              <li key={k} className="px-4 py-3">
                <Switch checked={p.kinds[k]?.push ?? false} disabled={p.paused} onCheckedChange={(push) => save({ kinds: { [k]: { push } } })}
                  label={t(INFO[k].label)} description={t(INFO[k].hint)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const DEVICE_TEXT: Record<DevicePushState, string> = {
  on: "Ativas neste aparelho: os avisos ligados abaixo chegam aqui.",
  off: "Ative para receber neste aparelho os avisos ligados abaixo.",
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
