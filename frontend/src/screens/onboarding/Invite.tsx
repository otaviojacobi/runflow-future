/** A3 · Convite: personal invite page (D-023). Public, in Runflow's brand with the club's logo; only the invited e-mail can accept. Route: /invite/$token */
import { useNavigate, useParams } from "@tanstack/react-router";
import { CircleAlert, LogIn, LogOut, Mail, MapPin, Users } from "lucide-react";
import { useAcceptInvite, usePublicInvite } from "@/api/clubs";
import { fetchMe, meKey, useMe } from "@/api/me";
import { signOut } from "@/api/auth";
import { ClubLogo, RunflowWordmark } from "@/components/brand";
import { SportChip } from "@/components/sport";
import { t, tn } from "@/i18n";
import { fullDate, localDate } from "@/lib/format";
import { ApiError } from "@/lib/api";
import { homeFor, selectClub } from "@/lib/club";
import { session } from "@/lib/session";
import { queryClient } from "@/queryClient";
import { Button, ButtonLink, Card, EmptyState, Skeleton, toast } from "@/ui";

const REASON: Record<string, [string, string]> = {
  revoked: ["Este convite foi cancelado", "Peça um novo convite para quem te convidou."],
  expired: ["Este convite expirou", "Os convites valem 7 dias. Peça para quem te convidou reenviar."],
  accepted: ["Este convite já foi usado", "Ele já foi aceito. Entre com sua conta para abrir o clube."],
  club_full: ["O clube está lotado", "O clube atingiu o limite de alunos do plano. Avise o seu treinador para liberar novas vagas."],
};

export function InviteScreen() {
  const { token } = useParams({ from: "/invite/$token" });
  const navigate = useNavigate();
  const inv = usePublicInvite(token);
  const accept = useAcceptInvite();
  const signedIn = session.isSignedIn();
  const me = useMe();

  const join = () =>
    accept.mutate(token, {
      onSuccess: async (r) => {
        const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
        const m = me.memberships.find((x) => x.club.id === r.club.id) ?? null;
        selectClub(m);
        if (r.already_member) return navigate({ to: homeFor(m?.membership.role) });
        toast.success(t("Você entrou no {club}!", { club: r.club.name }));
        navigate({ to: r.membership.role === "student" ? "/welcome" : "/dashboard" });
      },
      onError: toast.error,
    });

  const d = inv.data;
  const notFound = inv.error instanceof ApiError && inv.error.status === 404;
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-lg items-center px-5 py-4"><RunflowWordmark className="opacity-80" /></header>
      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center px-5 pb-16">
        {inv.isPending ? (
          <Card className="grid justify-items-center gap-4 p-8"><Skeleton className="size-20 rounded-2xl" /><Skeleton className="h-7 w-64" /><Skeleton className="h-4 w-48" /></Card>
        ) : notFound || !d ? (
          <Card><EmptyState icon={<CircleAlert />} title={t("Convite não encontrado")} action={<ButtonLink to="/clubs" variant="secondary">{t("Voltar")}</ButtonLink>}>{t("O link pode ter sido trocado por um mais novo. Abra o último e-mail de convite ou peça para reenviar.")}</EmptyState></Card>
        ) : (
          <Card className="grid justify-items-center gap-5 overflow-hidden p-0 text-center">
            <div className="h-20 w-full bg-brand" />
            <ClubLogo club={d.club} branding={d.branding} size={88} className="-mt-16 rounded-2xl ring-4 ring-surface" />
            <div className="grid gap-2 px-6">
              <p className="rf-text-overline text-fg-muted">{d.invited_by ? (d.name ? t("{name}, {by} te convidou", { name: d.name, by: d.invited_by }) : t("{name} te convidou", { name: d.invited_by })) : t("Você foi convidado(a)")}</p>
              <h1 className="rf-text-display-sm">{d.club.name}</h1>
              <p className="text-fg-muted">{d.role === "trainer" ? t("Entre na equipe de treinadores do clube.") : t("Seus treinos, sua agenda e o seu progresso, com o clube junto.")}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 px-6">
              {d.club.modalities.map((s) => <SportChip key={s} sport={s} size="sm" />)}
            </div>
            <p className="inline-flex items-center gap-1.5 px-6 text-sm"><Mail className="size-4 text-fg-muted" />{t("Convite para {email}", { email: d.email_hint })}{d.valid ? ` · ${t("vale até {d}", { d: fullDate(localDate(d.expires_at)) })}` : ""}</p>
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 px-6 text-sm text-fg-muted">
              {d.club.city && <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" />{d.club.city}{d.club.state ? ` · ${d.club.state}` : ""}</span>}
              {d.members > 0 && <span className="inline-flex items-center gap-1.5"><Users className="size-4" />{tn(d.members, "{n} aluno treinando", "{n} alunos treinando")}</span>}
            </div>
            <div className="grid w-full gap-3 border-t border-line-subtle bg-sunken px-6 py-5">
              {!d.valid && d.reason ? (
                <div className="grid gap-1 text-left"><p className="flex items-center gap-2 font-semibold text-danger-text"><CircleAlert className="size-5" />{t(REASON[d.reason]![0])}</p><p className="text-sm text-fg-muted">{d.reason === "club_full" && d.role === "trainer" ? t("O clube atingiu o limite de treinadores do plano. Avise quem te convidou.") : t(REASON[d.reason]![1])}</p></div>
              ) : d.already_member ? (
                <Button size="lg" block onClick={join} loading={accept.isPending}>{t("Você já participa. Abrir o clube")}</Button>
              ) : signedIn && d.email_matches === false ? (
                <div className="grid gap-3 text-left">
                  <p className="flex items-start gap-2 text-sm"><CircleAlert className="mt-0.5 size-5 shrink-0 text-warning-text" /><span>{t("Você entrou como {me}, mas este convite é para {email}. Entre com o e-mail que recebeu o convite.", { me: me.data?.user.email ?? "", email: d.email_hint })}</span></p>
                  <Button size="lg" block variant="secondary" icon={<LogOut />} onClick={async () => { await signOut(); navigate({ to: "/login", search: { redirect: `/invite/${token}`, email: d.email ?? undefined } }); }}>{t("Sair e entrar com outro e-mail")}</Button>
                </div>
              ) : signedIn ? (
                <Button size="lg" block onClick={join} loading={accept.isPending}>{d.role === "trainer" ? t("Entrar como treinador(a)") : t("Aceitar convite")}</Button>
              ) : (
                <>
                  <ButtonLink to="/login" search={{ redirect: `/invite/${token}`, email: d.email ?? undefined }} size="lg" block icon={<LogIn />}>{t("Entrar para aceitar")}</ButtonLink>
                  <p className="text-xs text-fg-muted">{t("Entre com o e-mail que recebeu o convite ({email}), pela conta Google ou com um código.", { email: d.email_hint })}</p>
                </>
              )}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
