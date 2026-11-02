import { Activity, Check, Link2, Unlink, Watch } from "lucide-react";
import { useState } from "react";
import { IS_MOCK } from "@/api/auth";
import { useConnections, useDisconnect, useStravaCallback, useStravaStart } from "@/api/account";
import { t } from "@/i18n";
import { ago } from "@/lib/format";
import { Badge, Button, Card, Dialog, toast } from "@/ui";

/** Strava connect/disconnect card (+ Garmin "em breve"). Mock: an in-app authorization dialog stands in for Strava's page. */
export function ProviderConnections({ onConnected }: { onConnected?: () => void }) {
  const conns = useConnections();
  const start = useStravaStart();
  const callback = useStravaCallback();
  const disconnect = useDisconnect();
  const [authorize, setAuthorize] = useState(false);
  const strava = conns.data?.find((c) => c.provider === "strava")?.connection;

  const connect = () =>
    start.mutate(undefined, {
      onSuccess: (r) => { if (IS_MOCK) setAuthorize(true); else window.location.href = r.authorize_url; },
      onError: toast.error,
    });
  const finish = () =>
    callback.mutate("mock-code", {
      onSuccess: () => { setAuthorize(false); toast.success(t("Strava conectado"), t("Suas atividades recentes já foram importadas.")); onConnected?.(); },
      onError: toast.error,
    });

  return (
    <div className="grid gap-3">
      <Card className="flex flex-wrap items-center gap-4 p-4">
        <span className="grid size-11 place-items-center rounded-lg bg-soft text-fg"><Activity className="size-6" /></span>
        <div className="min-w-[12rem] flex-1">
          <div className="flex items-center gap-2 font-semibold">Strava {strava && <Badge tone="success" icon={<Check />}>{t("Conectado")}</Badge>}</div>
          <p className="text-sm text-fg-muted">{strava ? t("Última sincronização {when}.", { when: strava.last_sync_at ? ago(strava.last_sync_at) : t("agora") }) : t("Seus treinos chegam sozinhos quando você termina a atividade.")}</p>
        </div>
        {strava ? (
          <Button variant="ghost" size="sm" icon={<Unlink />} loading={disconnect.isPending} onClick={() => disconnect.mutate("strava", { onSuccess: () => toast.success(t("Strava desconectado"), t("Apagamos os dados que vieram do Strava.")) })}>{t("Desconectar")}</Button>
        ) : (
          <Button icon={<Link2 />} loading={start.isPending} onClick={connect} className="w-full sm:w-auto">{t("Conectar com Strava")}</Button>
        )}
      </Card>
      <Card className="flex items-center gap-4 bg-sunken p-4">
        <span className="grid size-11 place-items-center rounded-lg bg-soft text-fg"><Watch className="size-6" /></span>
        <div className="min-w-0 flex-1"><div className="font-semibold">Garmin</div><p className="text-sm text-fg-muted">{t("Em breve: treinos direto no relógio.")}</p></div>
        <Badge>{t("Em breve")}</Badge>
      </Card>
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
