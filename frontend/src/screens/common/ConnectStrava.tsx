/** /connect/strava: where Strava sends the person back after they authorize (S9). Finishes the connection and returns
 * to where they started (Minha conta or the welcome flow). Mock: the in-app consent dialog does this instead. */
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect, useRef } from "react";
import { useStravaCallback } from "@/api/account";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { stravaReturn } from "@/components/account/StravaConnect";
import { ButtonLink, Card, toast } from "@/ui";

export function ConnectStravaScreen() {
  const { code, state, scope, error } = useSearch({ from: "/authed/shell/connect/strava" });
  const navigate = useNavigate();
  const callback = useStravaCallback();
  const started = useRef(false);
  const back = stravaReturn.take();
  useEffect(() => {
    if (started.current || error || !code) return;
    started.current = true;
    callback.mutate({ code, state, scope }, {
      onSuccess: () => { toast.success(t("Strava conectado"), t("Suas atividades recentes estão chegando.")); navigate({ to: back as "/account", replace: true }); },
    });
  }, [code, state, scope, error]); // eslint-disable-line react-hooks/exhaustive-deps

  const failed = error || !code || callback.isError;
  const detail = error === "access_denied" ? t("Você não autorizou o acesso. Pode tentar de novo quando quiser.")
    : callback.error instanceof ApiError ? callback.error.detail : t("O Strava não devolveu a autorização. Tente conectar de novo.");
  return (
    <Card className="mx-auto grid max-w-md justify-items-center gap-4 p-8 text-center">
      {failed ? (
        <>
          <CircleAlert className="size-10 text-danger-text" aria-hidden />
          <h1 className="rf-text-title-lg">{t("Não conectamos o Strava")}</h1>
          <p className="text-fg-muted">{detail}</p>
          <ButtonLink to={back as "/account"}>{t("Voltar")}</ButtonLink>
        </>
      ) : (
        <>
          <LoaderCircle className="size-10 animate-spin text-brand-text" aria-hidden />
          <h1 className="rf-text-title-lg">{t("Conectando o Strava…")}</h1>
        </>
      )}
    </Card>
  );
}
