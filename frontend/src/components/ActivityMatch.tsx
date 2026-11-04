/**
 * Activity matching (D-049): the question "Qual treino foi esta atividade?" (Hoje, Atividades, the activity) and the
 * dialog that changes or picks the workout an activity was. Choosing calls PUT /me/activities/{id}/match.
 */
import { Check, CircleHelp } from "lucide-react";
import { useState } from "react";
import { useMatchActivity } from "@/api/activities";
import type { ActivityItem, MatchOption } from "@/api/types";
import { t } from "@/i18n";
import { distance, duration, localDate, shortDate, timeOf } from "@/lib/format";
import { dayOffset, plannedSize } from "@/lib/matching";
import { Button, Card, Dialog, cn, toast } from "@/ui";

/** Saves a choice (`null` = none of them) and says so. */
function useChoose(a: ActivityItem, onDone?: () => void) {
  const m = useMatchActivity();
  const [saving, setSaving] = useState<string | null | undefined>(undefined);
  const choose = (o: MatchOption | null) => {
    setSaving(o?.id ?? null);
    m.mutate({ id: a.id, planned_workout_id: o?.id ?? null }, {
      onSuccess: () => { toast.success(o ? t("Atividade ligada ao treino") : t("Tudo certo, fica como treino extra"), o ? o.title : undefined); onDone?.(); },
      onError: toast.error,
      onSettled: () => setSaving(undefined),
    });
  };
  return { choose, saving, busy: m.isPending };
}

const actSize = (a: ActivityItem) => (a.distance_m ? distance(a.distance_m, { swim: a.sport === "swim" }) : duration(a.moving_time_s ?? a.duration_s));

/** One button per workout: its title, planned day (and how early or late the activity was), planned size. */
function Options({ a, current, saving, busy, onChoose }: { a: ActivityItem; current?: string | null; saving: string | null | undefined; busy: boolean; onChoose: (o: MatchOption) => void }) {
  const day = localDate(a.started_at);
  return (
    <ul className="grid gap-2">
      {a.match_options.map((o) => {
        const on = o.id === current;
        const size = plannedSize(o, o.sport);
        return (
          <li key={o.id}>
            <button type="button" disabled={busy} aria-pressed={on} aria-busy={saving === o.id || undefined} onClick={() => onChoose(o)}
              className={cn("relative flex min-h-11 w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-soft focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand-ring/40 disabled:cursor-wait", on ? "border-brand-line bg-brand-soft text-on-brand-soft" : "border-line-strong bg-surface")}>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{o.title}</span>
                <span className={cn("block text-sm", on ? "text-on-brand-soft" : "text-fg-muted")}>{shortDate(o.date)} · {dayOffset(day, o.date)}{size ? ` · ${size}` : ""}</span>
              </span>
              {on ? <><Check className="size-5 shrink-0" /><span className="sr-only">{t("(atual)")}</span></> :<span className="shrink-0 text-sm font-semibold text-brand-text">{saving === o.id ? t("Salvando…") : t("Foi este")}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The question for a pending activity. `embedded` drops the card (inside a list's card, under the activity's row);
 * `withActivity` repeats which activity it is (off where the activity is already on screen).
 */
export function MatchQuestion({ a, embedded = false, withActivity = true, heading = "h2" }: { a: ActivityItem; embedded?: boolean; withActivity?: boolean; heading?: "h2" | "h3" }) {
  const { choose, saving, busy } = useChoose(a);
  const H = heading;
  const body = (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-soft text-on-brand-soft"><CircleHelp className="size-5" /></span>
        <div className="grid min-w-0 gap-0.5">
          <H className="rf-text-title-sm">{t("Qual treino foi esta atividade?")}</H>
          {withActivity && <p className="text-sm font-semibold">{a.name} · {shortDate(localDate(a.started_at))}, {timeOf(a.started_at)} · {actSize(a)}</p>}
          <p className="text-sm text-fg-muted">{t("Ela combina com mais de um treino planejado. Escolha o certo e ele fica concluído.")}</p>
        </div>
      </div>
      <Options a={a} saving={saving} busy={busy} onChoose={choose} />
      <Button variant="ghost" size="sm" className="w-fit" disabled={busy} loading={saving === null} onClick={() => choose(null)}>{t("Nenhum destes (treino extra)")}</Button>
    </div>
  );
  return embedded ? <div className="px-2 pb-3 pt-1">{body}</div> : <Card edge="brand" className="p-4">{body}</Card>;
}

/** "Trocar treino" / "Escolher treino": any workout of the activity's options (the detail lists the nearby ones). */
export function ChangeMatchDialog({ a, open, onOpenChange }: { a: ActivityItem; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { choose, saving, busy } = useChoose(a, () => onOpenChange(false));
  const current = a.matched_workout?.id ?? null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={current ? t("Trocar treino") : t("Escolher treino")} description={t("Qual treino planejado foi esta atividade?")}
      footer={<>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>{t("Cancelar")}</Button>
        {a.match_state !== "dismissed" && <Button variant="secondary" disabled={busy} loading={saving === null} onClick={() => choose(null)}>{t("Nenhum destes (treino extra)")}</Button>}
      </>}>
      {a.match_options.length ? <Options a={a} current={current} saving={saving} busy={busy} onChoose={(o) => (o.id === current ? onOpenChange(false) : choose(o))} />
        : <p className="text-fg-muted">{t("Nenhum treino seu desta modalidade perto desta data.")}</p>}
    </Dialog>
  );
}
