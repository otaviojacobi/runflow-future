/** O6 · Financeiro: student fees — monthly charges, payments, reminders, fee plans, receivables account. Route: /club/finances */
import { Link } from "@tanstack/react-router";
import { Bell, Ban, ChevronLeft, ChevronRight, CircleCheck, MoreHorizontal, Pencil, Plus, Receipt as ReceiptIcon, Sparkles, Wallet } from "lucide-react";
import { useState } from "react";
import { useArchiveFeePlan, useAssignFee, useChargeAction, useCharges, useConnectAccount, useCreateCharge, useFeePlans, useFinanceSummary, useGenerateCharges, useRemoveFee, useSaveFeePlan, useStudentFees } from "@/api/finances";
import type { Charge, ChargeMethod, Club, FeePlan, StudentFeeRow } from "@/api/types";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { ago, centsToInput, fullDate, money, parseMoney, today as todayFn } from "@/lib/format";
import { Avatar, Badge, Button, Card, Dialog, EmptyState, Field, IconButton, Input, Menu, PageHeader, Select, Skeleton, Tabs, Textarea, cn, toast, type Tone } from "@/ui";

const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const monthLabel = (p: string) => `${MONTHS[+p.slice(5, 7) - 1]} ${p.slice(0, 4)}`;
const shiftMonth = (p: string, n: number) => { const d = new Date(Date.UTC(+p.slice(0, 4), +p.slice(5, 7) - 1 + n, 1)); return d.toISOString().slice(0, 7); };
export const METHOD_LABEL: Record<ChargeMethod, string> = { pix: "Pix", card: "Cartão", boleto: "Boleto", cash: "Dinheiro", transfer: "Transferência", other: "Outro" };
const INTERVAL_LABEL = { month: "por mês", quarter: "por trimestre", year: "por ano" } as const;
export const STATE: Record<Charge["state"], { label: string; tone: Tone }> = { open: { label: "Em aberto", tone: "info" }, overdue: { label: "Atrasada", tone: "danger" }, paid: { label: "Paga", tone: "success" }, void: { label: "Cancelada", tone: "neutral" } };

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" }) {
  return <Card className="p-4"><div className="text-sm text-fg-muted">{label}</div><div className={cn("font-display text-[26px] font-bold leading-tight tabular-nums [font-stretch:110%]", tone === "danger" && "text-danger-text")}>{value}</div>{sub && <div className="text-xs text-fg-muted">{sub}</div>}</Card>;
}

export function FinancesScreen() {
  const { club } = useClub();
  const [period, setPeriod] = useState(() => todayFn(club?.timezone).slice(0, 7));
  const [tab, setTab] = useState("charges");
  const summary = useFinanceSummary(club?.id, period);
  const connect = useConnectAccount(club?.id ?? "");
  if (!club) return null;
  const s = summary.data;
  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <PageHeader title={t("Financeiro")} subtitle={t("Mensalidades dos alunos: cobranças, pagamentos e lembretes")} />
      {s && s.account !== "active" && (
        <Card tone="brand" className="flex flex-wrap items-center gap-4 p-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-on-brand"><Wallet className="size-5" /></span>
          <div className="min-w-0 flex-1"><div className="font-semibold">{t("Receba por Pix e cartão direto no app")}</div><div className="text-sm">{t("Conecte a conta do clube para os alunos pagarem com um toque. Enquanto isso, registre os pagamentos manualmente.")}</div></div>
          <Button loading={connect.isPending} onClick={() => connect.mutate(undefined, { onSuccess: () => toast.success(t("Conta conectada"), t("Os alunos já podem pagar pelo app.")) })}>{t("Conectar conta")}</Button>
        </Card>
      )}
      <div className="flex items-center gap-1">
        <IconButton variant="secondary" label={t("Mês anterior")} onClick={() => setPeriod(shiftMonth(period, -1))}><ChevronLeft /></IconButton>
        <span className="w-40 text-center font-semibold first-letter:uppercase">{monthLabel(period)}</span>
        <IconButton variant="secondary" label={t("Próximo mês")} onClick={() => setPeriod(shiftMonth(period, 1))}><ChevronRight /></IconButton>
      </div>
      {!s ? <Skeleton className="h-24" /> : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label={t("Previsto no mês")} value={money(s.expected_cents)} sub={t("{n} cobranças", { n: s.charges })} />
          <Kpi label={t("Recebido")} value={money(s.received_cents)} sub={t("{p} de {n} pagas", { p: s.paid, n: s.charges })} />
          <Kpi label={t("A receber")} value={money(s.open_cents)} sub={t("ainda no prazo")} />
          <Kpi label={t("Em atraso")} value={money(s.overdue_total_cents)} sub={s.overdue_students ? tn(s.overdue_students, "{n} aluno, todos os meses", "{n} alunos, todos os meses") : t("ninguém em atraso")} tone={s.overdue_total_cents ? "danger" : undefined} />
        </div>
      )}
      <Tabs.Root value={tab} onValueChange={setTab}>
        <Tabs.List><Tabs.Trigger value="charges">{t("Cobranças")}</Tabs.Trigger><Tabs.Trigger value="students">{t("Alunos")}</Tabs.Trigger><Tabs.Trigger value="plans">{t("Planos de mensalidade")}</Tabs.Trigger></Tabs.List>
        <Tabs.Content value="charges"><Charges club={club} period={period} generated={s?.generated ?? true} withFee={s?.students_with_fee ?? 0} /></Tabs.Content>
        <Tabs.Content value="students"><Students club={club} /></Tabs.Content>
        <Tabs.Content value="plans"><Plans club={club} /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

// ---------------------------------------------------------------- charges
function Charges({ club, period, generated, withFee }: { club: Club; period: string; generated: boolean; withFee: number }) {
  const [state, setState] = useState("");
  const list = useCharges(club.id, { period, state: state || undefined });
  const gen = useGenerateCharges(club.id);
  const act = useChargeAction(club.id);
  const [paying, setPaying] = useState<Charge | null>(null);
  const [oneOff, setOneOff] = useState(false);
  const run = (c: Charge, action: "void" | "remind", ok: string) => act.mutate({ id: c.id, action }, { onSuccess: () => toast.success(ok), onError: toast.error });
  return (
    <div className="grid gap-3">
      {!generated && withFee > 0 && (
        <Card tone="accent" className="flex flex-wrap items-center gap-3 p-4">
          <Sparkles className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 text-sm">{t("As mensalidades de {m} ainda não foram geradas. {n} alunos têm plano.", { m: MONTHS[+period.slice(5, 7) - 1], n: withFee })}</span>
          <Button loading={gen.isPending} onClick={() => gen.mutate(period, { onSuccess: (r) => toast.success(t("{n} cobranças geradas", { n: r.created }), t("Os alunos foram avisados.")) })}>{t("Gerar cobranças")}</Button>
        </Card>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Situação")}>
          {[["", "Todas"], ["open", "Em aberto"], ["overdue", "Atrasadas"], ["paid", "Pagas"]].map(([v, l]) => <button key={v} onClick={() => setState(v!)} aria-pressed={state === v} className={cn("h-8 rounded-full border px-3 text-[13px] font-semibold", state === v ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{t(l!)}</button>)}
        </div>
        <Button variant="secondary" icon={<Plus />} onClick={() => setOneOff(true)}>{t("Cobrança avulsa")}</Button>
      </div>
      <Card className="overflow-x-auto">
        {list.isPending ? <Skeleton className="m-4 h-40" /> : !list.data?.length ? <EmptyState icon={<Wallet />} title={t("Nenhuma cobrança aqui")}>{t("Defina os planos dos alunos e gere as mensalidades do mês.")}</EmptyState> : (
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line bg-sunken text-left text-xs text-fg-muted"><tr><th className="px-4 py-2.5 font-semibold">{t("Aluno")}</th><th className="px-4 py-2.5 font-semibold">{t("Descrição")}</th><th className="px-4 py-2.5 font-semibold">{t("Vencimento")}</th><th className="px-4 py-2.5 text-right font-semibold">{t("Valor")}</th><th className="px-4 py-2.5 font-semibold">{t("Situação")}</th><th className="px-4 py-2.5"><span className="sr-only">{t("Ações")}</span></th></tr></thead>
            <tbody className="divide-y divide-line-subtle">
              {list.data.map((c) => (
                <tr key={c.id} className={cn(c.state === "void" && "text-fg-muted")}>
                  <td className="px-4 py-2.5"><span className="flex items-center gap-2"><Avatar name={c.athlete.user.name} src={c.athlete.user.avatar_url} size={26} /><span className="font-semibold">{c.athlete.user.name}</span></span></td>
                  <td className="px-4 py-2.5">{c.description}</td>
                  <td className="px-4 py-2.5 tabular-nums">{fullDate(c.due_date)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{money(c.amount_cents)}</td>
                  <td className="px-4 py-2.5"><Badge tone={STATE[c.state].tone}>{t(STATE[c.state].label)}</Badge>{c.state === "paid" && c.method && <span className="ml-2 text-xs text-fg-muted">{t(METHOD_LABEL[c.method])}</span>}{c.last_reminded_at && c.status === "open" && <div className="text-xs text-fg-muted">{t("lembrado {a}", { a: ago(c.last_reminded_at) })}</div>}</td>
                  <td className="px-2 py-2.5 text-right">
                    {c.status === "paid" ? <Link to="/receipts/$id" params={{ id: c.id }} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm font-semibold text-brand-text hover:bg-soft"><ReceiptIcon className="size-4" />{t("Recibo")}</Link>
                      : c.status === "open" ? <Menu trigger={<IconButton size="sm" label={t("Ações da cobrança de {name}", { name: c.athlete.user.name })}><MoreHorizontal /></IconButton>} items={[
                        { label: t("Marcar como paga"), icon: <CircleCheck />, onSelect: () => setPaying(c) },
                        { label: t("Enviar lembrete"), icon: <Bell />, onSelect: () => run(c, "remind", t("Lembrete enviado")) },
                        "separator",
                        { label: t("Cancelar cobrança"), icon: <Ban />, danger: true, onSelect: () => run(c, "void", t("Cobrança cancelada")) },
                      ]} /> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <MarkPaidDialog club={club} charge={paying} onClose={() => setPaying(null)} />
      <OneOffDialog club={club} open={oneOff} onClose={() => setOneOff(false)} />
    </div>
  );
}

function MarkPaidDialog({ club, charge, onClose }: { club: Club; charge: Charge | null; onClose: () => void }) {
  const act = useChargeAction(club.id);
  const [method, setMethod] = useState<ChargeMethod>("pix");
  return (
    <Dialog open={!!charge} onOpenChange={(v) => !v && onClose()} size="sm" title={t("Registrar pagamento")} description={charge ? `${charge.athlete.user.name} · ${charge.description} · ${money(charge.amount_cents)}` : undefined}
      footer={<><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button loading={act.isPending} onClick={() => charge && act.mutate({ id: charge.id, action: "mark-paid", method }, { onSuccess: () => { toast.success(t("Pagamento registrado"), t("O recibo já está disponível para o aluno.")); onClose(); }, onError: toast.error })}>{t("Confirmar")}</Button></>}>
      <Field label={t("Como foi pago")}>{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as ChargeMethod)}>{(Object.keys(METHOD_LABEL) as ChargeMethod[]).map((m) => <option key={m} value={m}>{t(METHOD_LABEL[m])}</option>)}</Select>}</Field>
    </Dialog>
  );
}

function OneOffDialog({ club, open, onClose }: { club: Club; open: boolean; onClose: () => void }) {
  return <Dialog open={open} onOpenChange={(v) => !v && onClose()} title={t("Cobrança avulsa")} description={t("Inscrição em prova, uniforme, aula extra…")}>{open && <OneOffBody club={club} onClose={onClose} />}</Dialog>;
}
function OneOffBody({ club, onClose }: { club: Club; onClose: () => void }) {
  const students = useStudentFees(club.id);
  const create = useCreateCharge(club.id);
  const [v, setV] = useState({ membership_id: "", description: "", amount: "", due_date: todayFn(club.timezone) });
  const err = create.error instanceof ApiError ? create.error : null;
  const cents = parseMoney(v.amount);
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (cents) create.mutate({ membership_id: v.membership_id, description: v.description, amount_cents: cents, due_date: v.due_date }, { onSuccess: () => { toast.success(t("Cobrança criada"), t("O aluno foi avisado.")); onClose(); } }); }}>
      <Field label={t("Aluno")} error={err?.fieldError("membership_id")}>{(id) => <Select id={id} value={v.membership_id} onChange={(e) => setV({ ...v, membership_id: e.target.value })}><option value="">{t("Escolha…")}</option>{(students.data ?? []).map((s) => <option key={s.membership_id} value={s.membership_id}>{s.user.name}</option>)}</Select>}</Field>
      <Field label={t("Descrição")} error={err?.fieldError("description")}>{(id) => <Input id={id} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder={t("Ex.: Camiseta da equipe")} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Valor (R$)")} error={err?.fieldError("amount_cents") ?? (v.amount && !cents ? t("Valor inválido.") : null)}>{(id) => <Input id={id} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="80,00" inputMode="decimal" />}</Field>
        <Field label={t("Vencimento")} error={err?.fieldError("due_date")}>{(id) => <Input id={id} type="date" value={v.due_date} onChange={(e) => setV({ ...v, due_date: e.target.value })} />}</Field>
      </div>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button type="submit" disabled={!cents || !v.membership_id} loading={create.isPending}>{t("Criar cobrança")}</Button></div>
    </form>
  );
}

// ---------------------------------------------------------------- students
function Students({ club }: { club: Club }) {
  const rows = useStudentFees(club.id);
  const [edit, setEdit] = useState<StudentFeeRow | null>(null);
  if (rows.isPending) return <Skeleton className="h-64" />;
  return (
    <Card className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-line bg-sunken text-left text-xs text-fg-muted"><tr><th className="px-4 py-2.5 font-semibold">{t("Aluno")}</th><th className="px-4 py-2.5 font-semibold">{t("Plano")}</th><th className="px-4 py-2.5 text-right font-semibold">{t("Valor")}</th><th className="px-4 py-2.5 font-semibold">{t("Vencimento")}</th><th className="px-4 py-2.5 text-right font-semibold">{t("Em atraso")}</th><th className="px-4 py-2.5" /></tr></thead>
        <tbody className="divide-y divide-line-subtle">
          {(rows.data ?? []).map((r) => (
            <tr key={r.membership_id}>
              <td className="px-4 py-2.5"><span className="flex items-center gap-2"><Avatar name={r.user.name} src={r.user.avatar_url} size={26} /><span className="font-semibold">{r.user.name}</span></span></td>
              <td className="px-4 py-2.5">{r.fee ? r.fee.plan.name : <span className="text-fg-muted">{t("Sem plano")}</span>}</td>
              <td className="px-4 py-2.5 text-right tabular-nums">{r.fee ? <>{money(r.fee.effective_cents)}{r.fee.amount_cents != null && <Badge tone="info" className="ml-2">{t("desconto")}</Badge>}</> : "–"}</td>
              <td className="px-4 py-2.5">{r.fee ? t("dia {d}", { d: r.fee.due_day }) : "–"}</td>
              <td className={cn("px-4 py-2.5 text-right tabular-nums", r.overdue_cents > 0 && "font-semibold text-danger-text")}>{r.overdue_cents ? money(r.overdue_cents) : "–"}</td>
              <td className="px-2 py-2.5 text-right"><Button size="sm" variant="ghost" icon={<Pencil />} onClick={() => setEdit(r)}>{r.fee ? t("Editar") : t("Definir")}</Button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <FeeDialog club={club} row={edit} onClose={() => setEdit(null)} />
    </Card>
  );
}

function FeeDialog({ club, row, onClose }: { club: Club; row: StudentFeeRow | null; onClose: () => void }) {
  return <Dialog open={!!row} onOpenChange={(v) => !v && onClose()} size="sm" title={t("Mensalidade de {name}", { name: row?.user.name.split(" ")[0] ?? "" })}>{row && <FeeBody club={club} row={row} onClose={onClose} key={row.membership_id} />}</Dialog>;
}
function FeeBody({ club, row, onClose }: { club: Club; row: StudentFeeRow; onClose: () => void }) {
  const plans = useFeePlans(club.id);
  const assign = useAssignFee(club.id), remove = useRemoveFee(club.id);
  const [plan, setPlan] = useState(row.fee?.fee_plan_id ?? "");
  const [custom, setCustom] = useState(centsToInput(row.fee?.amount_cents));
  const [day, setDay] = useState(row.fee?.due_day ?? 10);
  const base = plans.data?.find((p) => p.id === plan)?.amount_cents;
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); assign.mutate({ membership_id: row.membership_id, fee_plan_id: plan, amount_cents: custom ? parseMoney(custom) : null, due_day: day }, { onSuccess: () => { toast.success(t("Mensalidade salva"), t("Vale a partir das próximas cobranças.")); onClose(); }, onError: toast.error }); }}>
      <Field label={t("Plano")}>{(id) => <Select id={id} value={plan} onChange={(e) => setPlan(e.target.value)}><option value="">{t("Escolha…")}</option>{(plans.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} · {money(p.amount_cents)}</option>)}</Select>}</Field>
      <Field label={t("Valor com desconto (R$)")} optional hint={base ? t("Vazio = valor do plano ({v})", { v: money(base) }) : undefined}>{(id, d) => <Input id={id} aria-describedby={d} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder={centsToInput(base)} inputMode="decimal" />}</Field>
      <Field label={t("Dia do vencimento")}>{(id) => <Select id={id} value={day} onChange={(e) => setDay(Number(e.target.value))}>{Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{d}</option>)}</Select>}</Field>
      <div className="flex flex-wrap justify-between gap-2">
        {row.fee ? <Button variant="ghost" className="text-danger-text" loading={remove.isPending} onClick={() => remove.mutate(row.membership_id, { onSuccess: () => { toast.success(t("Aluno sem mensalidade")); onClose(); } })}>{t("Remover mensalidade")}</Button> : <span />}
        <Button type="submit" disabled={!plan || (!!custom && !parseMoney(custom))} loading={assign.isPending}>{t("Salvar")}</Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- plans
function Plans({ club }: { club: Club }) {
  const plans = useFeePlans(club.id);
  const archive = useArchiveFeePlan(club.id);
  const [edit, setEdit] = useState<FeePlan | null | undefined>(undefined);
  return (
    <div className="grid gap-3">
      <div className="flex justify-end"><Button icon={<Plus />} onClick={() => setEdit(null)}>{t("Novo plano")}</Button></div>
      {plans.isPending ? <Skeleton className="h-40" /> : !plans.data?.length ? <Card><EmptyState icon={<Wallet />} title={t("Nenhum plano de mensalidade")}>{t("Ex.: Mensalidade corrida R$ 180, Corrida + funcional R$ 240.")}</EmptyState></Card> : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {plans.data.map((p) => (
            <Card key={p.id} className="grid content-start gap-2 p-4">
              <div className="flex items-start justify-between gap-2"><h3 className="font-semibold">{p.name}</h3><Menu trigger={<IconButton size="sm" label={t("Ações de {name}", { name: p.name })}><MoreHorizontal /></IconButton>} items={[{ label: t("Editar"), icon: <Pencil />, onSelect: () => setEdit(p) }, { label: t("Arquivar"), icon: <Ban />, danger: true, onSelect: () => archive.mutate(p.id, { onSuccess: () => toast.success(t("Plano arquivado")), onError: toast.error }) }]} /></div>
              <div><span className="font-display text-2xl font-bold tabular-nums">{money(p.amount_cents)}</span> <span className="text-sm text-fg-muted">{t(INTERVAL_LABEL[p.interval])}</span></div>
              {p.description && <p className="text-sm text-fg-muted">{p.description}</p>}
              <p className="text-sm">{p.students ? tn(p.students, "{n} aluno", "{n} alunos") : t("Nenhum aluno ainda")}</p>
            </Card>
          ))}
        </div>
      )}
      <PlanDialog club={club} value={edit} onClose={() => setEdit(undefined)} />
    </div>
  );
}
function PlanDialog({ club, value, onClose }: { club: Club; value: FeePlan | null | undefined; onClose: () => void }) {
  return <Dialog open={value !== undefined} onOpenChange={(v) => !v && onClose()} title={value ? t("Editar plano") : t("Novo plano de mensalidade")}>{value !== undefined && <PlanBody club={club} value={value} onClose={onClose} />}</Dialog>;
}
function PlanBody({ club, value, onClose }: { club: Club; value: FeePlan | null; onClose: () => void }) {
  const save = useSaveFeePlan(club.id);
  const [v, setV] = useState({ name: value?.name ?? "", amount: centsToInput(value?.amount_cents), interval: value?.interval ?? "month", description: value?.description ?? "" });
  const err = save.error instanceof ApiError ? save.error : null;
  const cents = parseMoney(v.amount);
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (cents) save.mutate({ id: value?.id, name: v.name, amount_cents: cents, interval: v.interval as FeePlan["interval"], description: v.description || null }, { onSuccess: () => { toast.success(value ? t("Plano salvo") : t("Plano criado")); onClose(); } }); }}>
      <Field label={t("Nome")} error={err?.fieldError("name")}>{(id) => <Input id={id} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t("Ex.: Mensalidade corrida")} autoFocus />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("Valor (R$)")} error={err?.fieldError("amount_cents") ?? (v.amount && !cents ? t("Valor inválido.") : null)}>{(id) => <Input id={id} value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} placeholder="180,00" inputMode="decimal" />}</Field>
        <Field label={t("Cobrança")}>{(id) => <Select id={id} value={v.interval} onChange={(e) => setV({ ...v, interval: e.target.value as FeePlan["interval"] })}><option value="month">{t("Mensal")}</option><option value="quarter">{t("Trimestral")}</option><option value="year">{t("Anual")}</option></Select>}</Field>
      </div>
      <Field label={t("O que inclui")} optional>{(id) => <Textarea id={id} rows={2} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />}</Field>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t("Cancelar")}</Button><Button type="submit" disabled={!cents} loading={save.isPending}>{t("Salvar")}</Button></div>
    </form>
  );
}
