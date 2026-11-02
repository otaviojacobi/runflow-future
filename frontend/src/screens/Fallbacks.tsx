/** 404 and unexpected-error pages (F20). Calm, pt-BR, with a way back. */
import { Link, useRouter } from "@tanstack/react-router";
import { Compass, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { RunflowWordmark } from "@/components/brand";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { session } from "@/lib/session";
import { holdRunflowBrand } from "@/lib/theme";
import { Button, buttonClass } from "@/ui";

function Frame({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-5 py-10 text-fg">
      <div className="grid max-w-md justify-items-center gap-5 text-center">
        <RunflowWordmark />
        <span className="grid size-16 place-items-center rounded-full bg-brand-soft text-on-brand-soft">{icon}</span>
        <h1 className="rf-text-display-sm">{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function NotFoundScreen() {
  useEffect(() => holdRunflowBrand(), []);
  const home = session.isSignedIn() ? "/app" : "/";
  return (
    <Frame icon={<Compass className="size-8" />} title={t("Página não encontrada")}>
      <p className="text-fg-muted">{t("O link pode estar errado ou a página mudou de lugar. Vamos voltar para o caminho certo.")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => history.back()} className={buttonClass("secondary")}>{t("Voltar")}</button>
        <Link to={home} className={buttonClass("primary")}>{t("Ir para o início")}</Link>
      </div>
    </Frame>
  );
}

export function ErrorScreen({ error, reset }: { error: unknown; reset?: () => void }) {
  const router = useRouter();
  const [details, setDetails] = useState(false);
  const api = error instanceof ApiError ? error : null;
  const message = api ? `${api.title}. ${api.detail}` : error instanceof Error ? error.message : String(error);
  return (
    <Frame icon={<TriangleAlert className="size-8" />} title={api?.title ?? t("Algo deu errado")}>
      <p className="text-fg-muted">{api?.detail ?? t("Tivemos um problema ao abrir esta tela. Tente de novo; se continuar, avise o suporte.")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button icon={<RotateCcw />} onClick={() => { reset?.(); router.invalidate(); }}>{t("Tentar de novo")}</Button>
        <Link to="/app" className={buttonClass("secondary")}>{t("Ir para o início")}</Link>
      </div>
      <button type="button" onClick={() => setDetails(!details)} className="text-xs text-fg-subtle underline-offset-2 hover:underline">{details ? t("Esconder detalhes") : t("Detalhes técnicos")}</button>
      {details && <pre className="max-w-full overflow-auto whitespace-pre-wrap rounded-md bg-sunken p-3 text-left font-mono text-xs text-fg-muted">{message}</pre>}
    </Frame>
  );
}
