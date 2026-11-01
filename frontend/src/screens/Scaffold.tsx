import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { t } from "@/i18n";

/** F0 placeholder: proves tokens, fonts, Tailwind binding and the mock API proxy. Replaced in F2. */
export function Scaffold() {
  const health = useQuery({ queryKey: ["health"], queryFn: () => api.get<{ ok: boolean; routes: number; anchor_date: string }>("/health") });
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 p-6">
      <img src="/favicon.svg" alt="" className="size-12" />
      <h1 className="rf-text-display-md">{t("O Runflow está chegando.")}</h1>
      <p className="text-fg-muted">{t("Base do app web pronta: tokens, fontes, rotas e API simulada.")}</p>
      <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
        {health.isPending && <span className="text-fg-muted">{t("Conectando à API…")}</span>}
        {health.isError && <span className="text-danger-text">{t("API simulada fora do ar. Rode npm run dev na raiz.")}</span>}
        {health.data && (
          <span className="text-success-text">
            {t("API simulada no ar: {routes} rotas, dados de {date}.", { routes: health.data.routes, date: health.data.anchor_date })}
          </span>
        )}
      </div>
      <button className="h-10 w-fit rounded-md border border-brand-edge bg-brand px-4 font-semibold text-on-brand hover:bg-brand-hover">
        {t("Botão com a cor do clube")}
      </button>
    </main>
  );
}
