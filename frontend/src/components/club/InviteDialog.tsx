/**
 * Invite by e-mail (D-023): one personal invite per address, valid 7 days, single use, only that e-mail can accept.
 * Used in the dashboard ("Convidar"), Membros e convites, and the club setup flow.
 */
import { CircleAlert, CircleCheck, Mail, Send } from "lucide-react";
import { useState } from "react";
import { useCreateInvite } from "@/api/clubs";
import { useGroups } from "@/api/members";
import type { Club } from "@/api/types";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { Button, Dialog, Field, Input, Segmented, Textarea, cn, toast } from "@/ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
/** "a@x.com, b@y.com\nc@z.com" → unique lowercase addresses (anything else is reported as invalid). */
export const splitEmails = (s: string) => [...new Set(s.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];

type Result = { email: string; ok: boolean; message?: string };

export function InviteForm({ club, onDone, compact }: { club: Club; onDone?: (sent: number) => void; compact?: boolean }) {
  const { isOwner } = useClub();
  const create = useCreateInvite(club.id);
  const groups = useGroups(club.id);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"student" | "trainer">("student");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const emails = splitEmails(text);
  const invalid = emails.filter((e) => !EMAIL.test(e));
  const valid = emails.filter((e) => EMAIL.test(e));
  const send = async () => {
    setBusy(true);
    const out: Result[] = [];
    for (const email of valid) {
      try { await create.mutateAsync({ email, role, name: valid.length === 1 && name.trim() ? name.trim() : undefined, group_ids: role === "student" ? groupIds : undefined }); out.push({ email, ok: true }); }
      catch (e) { out.push({ email, ok: false, message: e instanceof ApiError ? e.title : t("Não foi possível enviar") }); }
    }
    setBusy(false);
    setResults(out);
    const sent = out.filter((r) => r.ok).length;
    if (sent) { toast.success(tn(sent, "Convite enviado por e-mail", "{n} convites enviados por e-mail"), t("Vale por 7 dias.")); setText(""); setName(""); }
    if (sent === out.length) onDone?.(sent);
  };
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (valid.length && !invalid.length) send(); }}>
      {isOwner && <Segmented label={t("Convidar como")} value={role} onChange={setRole} className="w-fit" options={[{ value: "student", label: t("Aluno(a)") }, { value: "trainer", label: club.trainer_label === "professor" ? t("Professor(a)") : t("Treinador(a)") }]} />}
      <Field label={t("E-mails")} hint={t("Um ou vários, separados por vírgula ou em linhas. Cada pessoa recebe o próprio convite.")} error={invalid.length ? tn(invalid.length, "E-mail inválido: {list}", "E-mails inválidos: {list}", { list: invalid.join(", ") }) : null}>
        {(id, d) => compact ? <Input id={id} aria-describedby={d} type="email" value={text} onChange={(e) => setText(e.target.value)} placeholder="nome@email.com" autoComplete="off" /> : <Textarea id={id} aria-describedby={d} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={"ana@email.com\nbruno@email.com"} />}
      </Field>
      {valid.length <= 1 && <Field label={t("Nome")} optional hint={t("Usado na saudação do e-mail.")}>{(id, d) => <Input id={id} aria-describedby={d} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ex.: Ana")} />}</Field>}
      {role === "student" && (groups.data?.length ?? 0) > 0 && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 rf-text-label-sm">{t("Entrar nos grupos")} <span className="font-normal text-fg-muted">({t("opcional")})</span></legend>
          <div className="flex flex-wrap gap-2">{groups.data!.map((g) => { const on = groupIds.includes(g.id); return <button key={g.id} type="button" aria-pressed={on} onClick={() => setGroupIds(on ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])} className={cn("h-9 rounded-full border px-3.5 text-sm font-semibold", on ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{g.name}</button>; })}</div>
        </fieldset>
      )}
      <p className="flex items-start gap-2 rounded-md bg-sunken px-3 py-2 text-sm text-fg-muted"><Mail className="mt-0.5 size-4 shrink-0" />{t("O convite chega por e-mail, vale 7 dias e só funciona com o e-mail convidado. Dá para reenviar ou cancelar em Membros e convites.")}</p>
      {results.some((r) => !r.ok) && (
        <ul className="grid gap-1 text-sm" aria-live="polite">{results.map((r) => <li key={r.email} className="flex items-center gap-2">{r.ok ? <CircleCheck className="size-4 text-success-text" /> : <CircleAlert className="size-4 text-danger-text" />}<span className="font-semibold">{r.email}</span>{r.message && <span className="text-fg-muted">· {r.message}</span>}</li>)}</ul>
      )}
      <Button type="submit" icon={<Send />} disabled={!valid.length || invalid.length > 0} loading={busy} className="justify-self-end">{valid.length > 1 ? t("Enviar {n} convites", { n: valid.length }) : t("Enviar convite")}</Button>
    </form>
  );
}

export function InviteDialog({ club, open, onOpenChange }: { club: Club; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Convidar por e-mail")} description={t("Só entra no {club} quem recebe um convite.", { club: club.name })}>
      {open && <InviteForm club={club} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}
