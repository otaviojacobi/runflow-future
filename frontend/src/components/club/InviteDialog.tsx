/**
 * Invite by e-mail (D-023): one personal invite per address, valid 7 days, single use, only that e-mail can accept.
 * One person at a time (e-mail + name); the form clears for the next one. Many at once: the spreadsheet import.
 * Used in the dashboard ("Convidar"), Membros e convites, and the club setup flow.
 */
import { CircleCheck, Mail, Send } from "lucide-react";
import { useRef, useState } from "react";
import { useCreateInvite } from "@/api/clubs";
import { useGroups } from "@/api/members";
import type { Club } from "@/api/types";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { useClub } from "@/lib/club";
import { Button, Dialog, Field, Input, Segmented, cn, toast } from "@/ui";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function InviteForm({ club, onSent }: { club: Club; onSent?: (email: string) => void }) {
  const { isOwner } = useClub();
  const create = useCreateInvite(club.id);
  const groups = useGroups(club.id);
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"student" | "trainer">("student");
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [sent, setSent] = useState<{ email: string; name: string }[]>([]);
  const clean = email.trim().toLowerCase();
  const typo = clean.length > 3 && !EMAIL.test(clean);
  const err = create.error instanceof ApiError ? create.error : null;
  const send = () => create.mutate({ email: clean, role, name: name.trim() || undefined, group_ids: role === "student" ? groupIds : undefined }, {
    onSuccess: () => {
      toast.success(t("Convite enviado para {email}", { email: clean }), t("Vale por 7 dias."));
      setSent((s) => [{ email: clean, name: name.trim() }, ...s]);
      onSent?.(clean);
      setEmail(""); setName(""); create.reset();
      emailRef.current?.focus();
    },
  });
  return (
    <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); if (EMAIL.test(clean)) send(); }}>
      {isOwner && <Segmented label={t("Convidar como")} value={role} onChange={setRole} className="w-fit" options={[{ value: "student", label: t("Aluno(a)") }, { value: "trainer", label: club.trainer_label === "professor" ? t("Professor(a)") : t("Treinador(a)") }]} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t("E-mail")} error={typo ? t("Confira o e-mail, como nome@email.com.") : err ? `${err.title}. ${err.detail}` : null}>
          {(id, d) => <Input ref={emailRef} id={id} aria-describedby={d} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => { setEmail(e.target.value); if (create.error) create.reset(); }} placeholder="nome@email.com" />}
        </Field>
        <Field label={t("Nome completo")} optional hint={t("Usado na saudação do e-mail.")}>{(id, d) => <Input id={id} aria-describedby={d} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Ex.: Ana")} />}</Field>
      </div>
      {role === "student" && (groups.data?.length ?? 0) > 0 && (
        <fieldset className="grid gap-2">
          <legend className="mb-2 rf-text-label-sm">{t("Entrar nos grupos")} <span className="font-normal text-fg-muted">({t("opcional")})</span></legend>
          <div className="flex flex-wrap gap-2">{groups.data!.map((g) => { const on = groupIds.includes(g.id); return <button key={g.id} type="button" aria-pressed={on} onClick={() => setGroupIds(on ? groupIds.filter((x) => x !== g.id) : [...groupIds, g.id])} className={cn("h-9 rounded-full border px-3.5 text-sm font-semibold", on ? "border-brand-ring bg-brand-soft text-on-brand-soft" : "border-line bg-surface text-fg-muted hover:bg-soft")}>{g.name}</button>; })}</div>
        </fieldset>
      )}
      <p className="flex items-start gap-2 rounded-md bg-sunken px-3 py-2 text-sm text-fg-muted"><Mail className="mt-0.5 size-4 shrink-0" />{t("O convite chega por e-mail, vale 7 dias e só funciona com o e-mail convidado.")}</p>
      <Button type="submit" icon={<Send />} disabled={!EMAIL.test(clean)} loading={create.isPending} className="justify-self-end">{t("Enviar convite")}</Button>
      {sent.length > 0 && (
        <div className="grid gap-1.5 border-t border-line-subtle pt-3" aria-live="polite">
          <span className="rf-text-label-sm">{t("Convidados agora")}</span>
          <ul className="grid gap-1 text-sm">{sent.map((s) => <li key={s.email} className="flex items-center gap-2"><CircleCheck className="size-4 shrink-0 text-success-text" /><span className="truncate">{s.name ? `${s.name} · ` : ""}{s.email}</span></li>)}</ul>
        </div>
      )}
    </form>
  );
}

export function InviteDialog({ club, open, onOpenChange }: { club: Club; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t("Convidar por e-mail")} description={t("Uma pessoa por vez. Para convidar muitos de uma vez, importe uma planilha em Membros e convites.")}>
      {open && <InviteForm club={club} />}
    </Dialog>
  );
}
