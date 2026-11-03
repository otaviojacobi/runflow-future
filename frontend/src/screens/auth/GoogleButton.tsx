/** "Continuar com Google" on the real backend (S9): Google Identity Services renders its button and hands back an ID
 * token, which `/auth/google` verifies. The script loads only on the sign-in screen. The mock keeps its own chooser. */
import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";

interface Gis {
  accounts: { id: {
    initialize: (o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: "popup" | "redirect"; context?: string }) => void;
    renderButton: (el: HTMLElement, o: Record<string, string | number>) => void;
  } };
}
declare global { interface Window { google?: Gis } }

let loading: Promise<Gis> | null = null;
function loadGis(): Promise<Gis> {
  loading ??= new Promise<Gis>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.onload = () => (window.google ? resolve(window.google) : reject(new Error("gis")));
    s.onerror = () => { loading = null; reject(new Error("gis")); };
    document.head.appendChild(s);
  });
  return loading;
}

export function GoogleButton({ clientId, onCredential }: { clientId: string; onCredential: (idToken: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const callback = useRef(onCredential);
  callback.current = onCredential;
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    loadGis()
      .then((g) => {
        if (!alive || !ref.current) return;
        g.accounts.id.initialize({ client_id: clientId, callback: (r) => callback.current(r.credential), ux_mode: "popup", context: "signin" });
        g.accounts.id.renderButton(ref.current, { type: "standard", theme: "outline", size: "large", text: "continue_with", shape: "rectangular", locale: "pt-BR", width: Math.min(400, ref.current.offsetWidth || 320) });
      })
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [clientId]);
  if (failed) return <p className="text-sm text-fg-muted">{t("Não foi possível carregar o botão do Google. Entre com o código por e-mail.")}</p>;
  return <div ref={ref} className="flex min-h-11 w-full justify-center" />;
}
