import { Activity, Check, Unlink, Watch } from "lucide-react";
import { useState } from "react";
import { IS_MOCK } from "@/api/auth";
import { useConnections, useDisconnect, useStravaCallback, useStravaStart } from "@/api/account";
import type { Consent, ConsentKind, MembershipContext } from "@/api/types";
import { PoweredByStrava, StravaConnectButton } from "@/components/strava";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { ago } from "@/lib/format";
import { Badge, Button, Card, Checkbox, Dialog, Skeleton, cn, toast } from "@/ui";

/** Where to go back after Strava's page (the welcome flow, Atividades or Minha conta), kept across the redirect. */
export const stravaReturn = {
  remember: () => { try { sessionStorage.setItem("rf.stravaReturn", window.location.pathname + window.location.hash); } catch { /* storage blocked: back to Minha conta */ } },
  take: (): string => { try { const v = sessionStorage.getItem("rf.stravaReturn"); return v && v.startsWith("/") ? v : "/account"; } catch { return "/account"; } },
};

/** The clubs where the person is an active student: the ones a Strava connection is shared with (D-011). */
export const studentClubs = (memberships: MembershipContext[]) =>
  memberships.filter((m) => m.membership.role === "student" && m.membership.status === "active");

/** "Pace Forte", "Pace Forte e Equipe Maré", "A, B e C". */
const names = (ms: MembershipContext[]) => {
  const n = ms.map((m) => m.club.name);
  return n.length > 1 ? `${n.slice(0, -1).join(", ")} ${t("e")} ${n[n.length - 1]}` : (n[0] ?? "");
};

/**
 * Whether ending this sharing (a consent revoked, or leaving the club when `kind` is absent) leaves no club seeing the
 * Strava sync: the server then disconnects Strava (D-011, endpoints.md § Strava sharing) and the warning says so.
 */
export function disconnectsStrava(p: { connected: boolean; consents: Consent[] | undefined; memberships: MembershipContext[]; clubId: string; kind?: ConsentKind }) {
  if (!p.connected) return false;
  const has = (club: string, kind: ConsentKind) => !!p.consents?.some((c) => c.kind === kind && c.club_id === club && !c.revoked_at);
  const ending = (club: string) => club === p.clubId && (p.kind === undefined || p.kind === "share_training_data" || p.kind === "share_strava");
  return !studentClubs(p.memberships).some((m) => !ending(m.club.id) && has(m.club.id, "share_training_data") && has(m.club.id, "share_strava"));
}
export const disconnectWarning = () => t("Isso desconecta o Strava: as atividades sincronizadas são apagadas do Runflow e seus treinadores deixam de vê-las. Você pode conectar de novo quando quiser.");

/**
 * The official "Connect with Strava" button under the sharing statement it requires (founder, 2026-11-04; D-011): the
 * connection exists for the trainers, so the statement starts checked and unchecking it disables the button. The API
 * shares with every club where the person is a student when the connection is made. Only students connect: anyone
 * else gets the reason instead. Real Strava: its page, then /connect/strava finishes. Mock: an in-app dialog.
 */
export function StravaConnectPanel({ onConnected, className }: { onConnected?: () => void; className?: string }) {
  const { me } = useClub();
  const start = useStravaStart();
  const callback = useStravaCallback();
  const [share, setShare] = useState(true);
  const [authorize, setAuthorize] = useState(false);
  const clubs = studentClubs(me?.memberships ?? []);

  if (!clubs.length) return <p className={cn("text-sm text-fg-muted", className)}>{t("Entre em um clube como aluno para conectar o Strava: a conexão existe para os seus treinadores acompanharem seus treinos.")}</p>;

  const connect = () =>
    start.mutate(undefined, {
      onSuccess: (r) => { if (IS_MOCK) setAuthorize(true); else { stravaReturn.remember(); window.location.href = r.authorize_url; } },
      onError: toast.error,
    });
  const finish = () =>
    callback.mutate({ code: "mock-code" }, {
      onSuccess: () => { setAuthorize(false); toast.success(t("Strava conectado"), t("Suas atividades recentes já foram importadas.")); onConnected?.(); },
      onError: toast.error,
    });

  return (
    <div className={cn("grid gap-4", className)}>
      <Checkbox checked={share} onChange={(e) => setShare(e.target.checked)}
        label={t("Compartilhar as atividades do Strava com os treinadores do {club}", { club: names(clubs) })}
        description={share ? t("O Strava exige o seu consentimento explícito para isso.") : t("A conexão com o Strava existe para os seus treinadores acompanharem seus treinos.")} />
      <StravaConnectButton loading={start.isPending} disabled={!share} onClick={connect} />
      <Dialog open={authorize} onOpenChange={setAuthorize} size="sm" title={t("Autorizar o Runflow no Strava")}
        description={t("Simulação: no app real, esta é a página do Strava.")}
        footer={<><Button variant="secondary" onClick={() => setAuthorize(false)}>{t("Cancelar")}</Button><Button loading={callback.isPending} onClick={finish}>{t("Autorizar")}</Button></>}>
        <ul className="grid gap-2 text-sm text-fg-muted">
          <li className="flex gap-2"><Check className="size-4 shrink-0 text-success-text" />{t("Ler suas atividades, inclusive as privadas")}</li>
          <li className="flex gap-2"><Check className="size-4 shrink-0 text-success-text" />{t("Ler seu perfil público")}</li>
        </ul>
      </Dialog>
    </div>
  );
}

/** Strava connect/disconnect card (+ Garmin "em breve"). */
export function ProviderConnections({ onConnected }: { onConnected?: () => void }) {
  const conns = useConnections();
  const disconnect = useDisconnect();
  const strava = conns.data?.find((c) => c.provider === "strava")?.connection;

  return (
    <div className="grid gap-3">
      <Card className="grid gap-4 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="grid size-11 place-items-center rounded-lg bg-soft text-fg"><Activity className="size-6" /></span>
          <div className="min-w-[12rem] flex-1">
            <div className="flex items-center gap-2 font-semibold">Strava {strava && <Badge tone="success" icon={<Check />}>{t("Conectado")}</Badge>}</div>
            <p className="text-sm text-fg-muted">{strava ? t("Última sincronização {when}.", { when: strava.last_sync_at ? ago(strava.last_sync_at) : t("agora") }) : t("Seus treinos chegam sozinhos quando você termina a atividade.")}</p>
          </div>
          {strava && <Button variant="ghost" size="sm" icon={<Unlink />} loading={disconnect.isPending} onClick={() => disconnect.mutate("strava", { onSuccess: () => toast.success(t("Strava desconectado"), t("Apagamos os dados que vieram do Strava.")) })}>{t("Desconectar")}</Button>}
        </div>
        {conns.isPending ? <Skeleton className="h-12" /> : strava ? <PoweredByStrava /> : <StravaConnectPanel onConnected={onConnected} />}
      </Card>
      <Card className="flex items-center gap-4 bg-sunken p-4">
        <span className="grid size-11 place-items-center rounded-lg bg-soft text-fg"><Watch className="size-6" /></span>
        <div className="min-w-0 flex-1"><div className="font-semibold">Garmin</div><p className="text-sm text-fg-muted">{t("Em breve: treinos direto no relógio.")}</p></div>
        <Badge>{t("Em breve")}</Badge>
      </Card>
    </div>
  );
}
