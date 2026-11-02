/** A6/A7 · Meus clubes: pick the active club, or start one / use an invite. Route: /clubs */
import { useNavigate } from "@tanstack/react-router";
import { ChevronRight, LogOut, Plus, Ticket } from "lucide-react";
import { useState } from "react";
import { signOut } from "@/api/auth";
import { useMe } from "@/api/me";
import type { MembershipContext } from "@/api/types";
import { ClubLogo, RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { ROLE_LABEL, activeMembership, homeFor, selectClub } from "@/lib/club";
import { Badge, Button, ButtonLink, Card, Field, Input, Skeleton } from "@/ui";


/** Accepts a full invite link (…/invite/abc) or just the code. */
export function inviteTokenFrom(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/invite\/([\w-]+)/);
  return m ? m[1]! : /^[\w-]{3,}$/.test(s) ? s : null;
}

export function ClubsScreen() {
  const me = useMe();
  const navigate = useNavigate();
  const [invite, setInvite] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const current = activeMembership(me.data);
  const open = (m: MembershipContext) => {
    selectClub(m);
    navigate({ to: homeFor(m.membership.role) });
  };
  const goInvite = (e: React.FormEvent) => {
    e.preventDefault();
    const token = inviteTokenFrom(invite);
    if (!token) return setInviteError(t("Cole o link do convite que chegou no seu e-mail, como runflow.club/invite/…"));
    navigate({ to: "/invite/$token", params: { token } });
  };
  const list = me.data?.memberships ?? [];

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col gap-8 px-5 py-8">
      <header className="flex items-center justify-between">
        <RunflowWordmark />
        <Button variant="ghost" size="sm" icon={<LogOut />} onClick={async () => { await signOut(); navigate({ to: "/login" }); }}>{t("Sair")}</Button>
      </header>
      {me.isPending ? (
        <div className="grid gap-3"><Skeleton className="h-8 w-48" /><Skeleton className="h-20" /><Skeleton className="h-20" /></div>
      ) : list.length ? (
        <section className="grid gap-4">
          <div>
            <h1 className="rf-text-display-sm">{t("Seus clubes")}</h1>
            <p className="mt-1 text-fg-muted">{t("Olá, {name}. Escolha onde você quer entrar.", { name: me.data!.user.name.split(" ")[0]! })}</p>
          </div>
          <ul className="grid gap-2">
            {list.map((m) => (
              <li key={m.club.id}>
                <button onClick={() => open(m)} className="flex w-full items-center gap-4 rounded-lg border border-line bg-surface p-4 text-left shadow-sm transition-colors hover:bg-soft">
                  <ClubLogo club={m.club} branding={m.branding} size={44} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{m.club.name}</span>
                    <span className="block text-sm text-fg-muted">{t(ROLE_LABEL[m.membership.role])}{m.club.city ? ` · ${m.club.city}` : ""}</span>
                  </span>
                  {current?.club.id === m.club.id && <Badge tone="brand">{t("Atual")}</Badge>}
                  <ChevronRight className="size-5 text-fg-subtle" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="grid gap-2">
          <h1 className="rf-text-display-sm">{t("Você ainda não está em um clube")}</h1>
          <p className="text-fg-muted">{t("Crie o seu clube grátis ou abra o convite que chegou no seu e-mail.")}</p>
        </section>
      )}

      <Card className="grid gap-5 p-5">
        <div className="grid gap-1">
          <h2 className="rf-text-title-md">{t("Criar um clube")}</h2>
          <p className="text-sm text-fg-muted">{t("Para assessorias, academias e equipes de natação. Grátis até 10 alunos.")}</p>
        </div>
        <ButtonLink to="/clubs/new" icon={<Plus />} block>{t("Criar meu clube")}</ButtonLink>
        <div className="h-px bg-line-subtle" />
        <form onSubmit={goInvite} className="grid gap-3">
          <Field label={t("Tenho um convite")} error={inviteError} hint={t("Cole o link ou o código do convite.")}>
            {(id, d) => <Input id={id} aria-describedby={d} placeholder="runflow.club/invite/…" value={invite} onChange={(e) => { setInvite(e.target.value); setInviteError(null); }} invalid={!!inviteError} />}
          </Field>
          <Button type="submit" variant="secondary" icon={<Ticket />}>{t("Usar convite")}</Button>
        </form>
      </Card>
    </div>
  );
}
