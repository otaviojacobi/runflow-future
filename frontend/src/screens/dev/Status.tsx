/** /dev/status: live view of docs/build-plan.md (what's done, what's next, how to try it). Dev/mock only. */
import { Link } from "@tanstack/react-router";
import { CircleCheck, CircleDashed, LoaderCircle, LogIn, Palette } from "lucide-react";
import plan from "../../../../docs/build-plan.md?raw";
import { RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { Badge, ButtonLink, Card, ProgressBar, cn } from "@/ui";

interface StepRow { id: string; scope: string; screens: string[]; done: boolean }
interface Phase { title: string; steps: StepRow[] }
const cells = (line: string) => line.split("|").slice(1, -1).map((c) => c.trim());
const strip = (s: string) => s.replace(/\*\*|`/g, "");

function parse(md: string) {
  const phases: Phase[] = [];
  const routes: Record<string, string> = {};
  let current: Phase | null = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^## (Phase \d+: .+)$/);
    if (h) { current = { title: strip(h[1]!), steps: [] }; phases.push(current); continue; }
    if (line.startsWith("## ")) current = null;
    if (!line.startsWith("|")) continue;
    const c = cells(line);
    if (current && /^[FXS]\d+$/.test(c[0] ?? "")) {
      const status = c[c.length - 1] ?? "";
      current.steps.push({ id: c[0]!, scope: strip(c[1] ?? ""), screens: c.length === 4 ? (c[2] ?? "").split(/,\s*/).filter((x) => x && x !== "—") : [], done: status.includes("[x]") });
    } else if (/^(A|M|W|O|C|DS)\d+$/.test(c[0] ?? "")) {
      const r = (c[2] ?? "").match(/`(\/[^`$:]*)`/);
      if (r && !r[1]!.includes(":")) routes[c[0]!] = r[1]!;
    }
  }
  return { phases, routes };
}
/** "A2, A7" or "M1–M7" style ids → list. */
const expand = (ids: string[]) => ids.flatMap((id) => {
  const m = id.match(/^([A-Z]+)(\d+)[–-]\1?(\d+)$/);
  return m ? Array.from({ length: Number(m[3]) - Number(m[2]) + 1 }, (_, i) => `${m[1]}${Number(m[2]) + i}`) : [id];
});

export function StatusScreen() {
  const { phases, routes } = parse(plan);
  const all = phases.flatMap((p) => p.steps);
  const next = all.find((s) => !s.done);
  return (
    <div className="mx-auto grid max-w-4xl gap-8 px-5 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <RunflowWordmark />
        <div className="flex gap-2"><ButtonLink to="/dev/components" variant="secondary" size="sm" icon={<Palette />}>{t("Componentes")}</ButtonLink><ButtonLink to="/login" size="sm" icon={<LogIn />}>{t("Entrar no app")}</ButtonLink></div>
      </header>
      <div className="grid gap-2">
        <h1 className="rf-text-display-sm">{t("Status do desenvolvimento")}</h1>
        <p className="text-fg-muted">{t("Gerado ao vivo a partir de docs/build-plan.md. Cada etapa concluída vira um commit no GitHub.")}</p>
      </div>
      <Card className="grid gap-3 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="font-semibold">{t("{done} de {total} etapas concluídas", { done: all.filter((s) => s.done).length, total: all.length })}</span>
          {next && <span className="text-sm text-fg-muted">{t("Agora: {id}", { id: next.id })}</span>}
        </div>
        <ProgressBar value={all.filter((s) => s.done).length} max={all.length} label={t("Progresso")} />
        <div className="grid gap-1 rounded-md bg-sunken p-3 text-sm">
          <span className="font-semibold">{t("Contas de demonstração (Continuar com Google)")}</span>
          <span className="text-fg-muted">{t("Marcos Oliveira: gestor do Pace Forte · Júlia Santos: treinadora · Ana Souza: aluna em dois clubes · Renata Prado: gestora da Equipe Maré. Ou qualquer e-mail com o código 000000.")}</span>
        </div>
      </Card>
      {phases.map((p) => {
        const done = p.steps.filter((s) => s.done).length;
        return (
          <section key={p.title} className="grid gap-3">
            <div className="flex items-baseline justify-between gap-3"><h2 className="rf-text-title-lg">{p.title}</h2><span className="text-sm text-fg-muted">{done}/{p.steps.length}</span></div>
            <Card className="divide-y divide-line-subtle">
              {p.steps.map((s) => {
                const active = s === next;
                const Icon = s.done ? CircleCheck : active ? LoaderCircle : CircleDashed;
                return (
                  <div key={s.id} className={cn("flex gap-3 px-4 py-3", active && "bg-brand-soft")}>
                    <Icon className={cn("mt-0.5 size-5 shrink-0", s.done ? "text-success-text" : active ? "animate-spin text-brand-text [animation-duration:3s]" : "text-fg-subtle")} />
                    <div className="grid min-w-0 flex-1 gap-1.5">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-bold tabular-nums">{s.id}</span>{active && <Badge tone="brand">{t("Em andamento")}</Badge>}{s.done && <Badge tone="success">{t("Pronto")}</Badge>}</div>
                      <p className={cn("text-sm", s.done || active ? "text-fg" : "text-fg-muted")}>{s.scope}</p>
                      {s.screens.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {expand(s.screens).map((id) => routes[id] && s.done
                            ? <Link key={id} to={routes[id]!} className="rounded-sm bg-brand-soft px-2 py-0.5 text-xs font-bold text-on-brand-soft hover:underline">{id} {routes[id]}</Link>
                            : <span key={id} className="rounded-sm bg-soft px-2 py-0.5 text-xs font-bold text-fg-muted">{id}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </Card>
          </section>
        );
      })}
    </div>
  );
}
