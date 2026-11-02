import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { ApiError } from "@/lib/api";
import { t } from "@/i18n";
import { cn } from "./cn";

type Kind = "success" | "error" | "info";
interface Toast { id: number; kind: Kind; title: string; detail?: string }
let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
function push(kind: Kind, title: string, detail?: string) {
  const id = ++seq;
  toasts = [...toasts.slice(-1), { id, kind, title, detail }];
  emit();
  setTimeout(() => dismiss(id), kind === "error" ? 6000 : 3500);
}
function dismiss(id: number) {
  toasts = toasts.filter((x) => x.id !== id);
  emit();
}
/** toast.success(t("Treino salvo")) · toast.error(err) shows the API's pt-BR title/detail. */
export const toast = {
  success: (title: string, detail?: string) => push("success", title, detail),
  info: (title: string, detail?: string) => push("info", title, detail),
  error: (err: unknown) => (err instanceof ApiError ? push("error", err.title, err.detail) : push("error", t("Algo deu errado"), t("Tente novamente em instantes."))),
};

export function Toaster() {
  const list = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => toasts);
  const Icon = { success: CircleCheck, error: CircleAlert, info: Info };
  return (
    <div data-print="hide" aria-live="polite" className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+12px)] z-[60] flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:bottom-6 sm:right-6 sm:top-auto sm:items-end">
      {list.map((x) => {
        const I = Icon[x.kind];
        return (
          <div key={x.id} role={x.kind === "error" ? "alert" : "status"} className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg bg-inverse px-4 py-3 text-fg-inverse shadow-lg animate-[sheet-in_200ms_var(--rf-easing-standard)]">
            <I className={cn("mt-0.5 size-5 shrink-0", x.kind === "error" ? "text-danger" : x.kind === "success" ? "text-success" : "text-info")} aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{x.title}</div>
              {x.detail && <div className="text-sm opacity-80">{x.detail}</div>}
            </div>
            <button onClick={() => dismiss(x.id)} className="-mr-1 grid size-7 place-items-center rounded-sm opacity-70 hover:opacity-100" aria-label={t("Fechar")}><X className="size-4" /></button>
          </div>
        );
      })}
    </div>
  );
}
