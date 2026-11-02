/** A3 · Convite: club-themed invite landing. Public; accepts after sign-in. Route: /invite/$token */
import { useNavigate, useParams } from "@tanstack/react-router";
import { CircleAlert, LogIn, MapPin, Users } from "lucide-react";
import { useEffect } from "react";
import { useAcceptInvite, usePublicInvite } from "@/api/clubs";
import { fetchMe, meKey } from "@/api/me";
import { ClubLogo, RunflowWordmark } from "@/components/brand";
import { SportChip } from "@/components/sport";
import { t, tn } from "@/i18n";
import { ApiError } from "@/lib/api";
import { homeFor, selectClub } from "@/lib/club";
import { session } from "@/lib/session";
import { applyClubTheme } from "@/lib/theme";
import { queryClient } from "@/queryClient";
import { Button, ButtonLink, Card, EmptyState, Skeleton, toast } from "@/ui";

const REASON: Record<string, [string, string]> = {
  revoked: ["Este convite foi cancelado", "Peça um novo link para quem te convidou."],
  expired: ["Este convite expirou", "Peça um novo link para quem te convidou."],
  used_up: ["Este convite já foi usado", "O link atingiu o limite de usos. Peça um novo."],
  club_full: ["O clube está lotado", "O clube atingiu o limite de alunos do plano. Avise o seu treinador para liberar novas vagas."],
};

export function InviteScreen() {
  const { token } = useParams({ from: "/invite/$token" });
  const navigate = useNavigate();
  const inv = usePublicInvite(token);
  const accept = useAcceptInvite();
  const signedIn = session.isSignedIn();
  useEffect(() => { if (inv.data?.branding) applyClubTheme(inv.data.branding.theme_css); }, [inv.data?.branding?.theme_rev]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <Card><EmptyState icon={<CircleAlert />} title={t("Convite não encontrado")} action={<ButtonLink to="/clubs" variant="secondary">{t("Voltar")}</ButtonLink>}>{t("Confira o link com quem te convidou.")}</EmptyState></Card>
        ) : (
          <Card className="grid justify-items-center gap-5 overflow-hidden p-0 text-center">
            <div className="h-20 w-full bg-brand" />
            <ClubLogo club={d.club} branding={d.branding} size={88} className="-mt-16 rounded-2xl ring-4 ring-surface" />
            <div className="grid gap-2 px-6">
              <p className="rf-text-overline text-fg-muted">{d.invited_by ? t("{name} te convidou", { name: d.invited_by }) : t("Você foi convidado(a)")}</p>
              <h1 className="rf-text-display-sm">{d.club.name}</h1>
              <p className="text-fg-muted">{d.role === "trainer" ? t("Entre na equipe de treinadores do clube.") : t("Seus treinos, sua agenda e o seu progresso, com o clube junto.")}</p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 px-6">
              {d.club.modalities.map((s) => <SportChip key={s} sport={s} size="sm" />)}
            </div>
            <div className="flex flex-wrap justify-center gap-x-5 gap-y-1 px-6 text-sm text-fg-muted">
              {d.club.city && <span className="inline-flex items-center gap-1.5"><MapPin className="size-4" />{d.club.city}{d.club.state ? ` · ${d.club.state}` : ""}</span>}
              {d.members > 0 && <span className="inline-flex items-center gap-1.5"><Users className="size-4" />{tn(d.members, "{n} aluno treinando", "{n} alunos treinando")}</span>}
            </div>
            <div className="grid w-full gap-3 border-t border-line-subtle bg-sunken px-6 py-5">
              {!d.valid && d.reason ? (
                <div className="grid gap-1 text-left"><p className="flex items-center gap-2 font-semibold text-danger-text"><CircleAlert className="size-5" />{t(REASON[d.reason]![0])}</p><p className="text-sm text-fg-muted">{t(REASON[d.reason]![1])}</p></div>
              ) : d.already_member ? (
                <Button size="lg" block onClick={join} loading={accept.isPending}>{t("Você já participa. Abrir o clube")}</Button>
              ) : signedIn ? (
                <Button size="lg" block onClick={join} loading={accept.isPending}>{d.role === "trainer" ? t("Entrar como treinador(a)") : t("Aceitar convite")}</Button>
              ) : (
                <>
                  <ButtonLink to="/login" search={{ redirect: `/invite/${token}` }} size="lg" block icon={<LogIn />}>{t("Entrar para aceitar")}</ButtonLink>
                  <p className="text-xs text-fg-muted">{t("Use sua conta Google ou o seu e-mail. Leva menos de um minuto.")}</p>
                </>
              )}
            </div>
          </Card>
        )}
      </main>
    </div>
  );
}
