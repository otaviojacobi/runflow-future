/** The web app, for what has no screen in the app yet (desktop tools, creating a club): opened in the in-app browser. */
import * as WebBrowser from "expo-web-browser";
import { t } from "@/i18n";
import { toast } from "@/ui";
import { WEB_URL } from "./api";

export const hasWeb = WEB_URL !== null;

/** Opens `path` (a web route, e.g. "/library") on the web app; says so when this build doesn't know where it is. */
export async function openOnWeb(path: string) {
  if (!WEB_URL) return toast.info(t("Disponível no computador"), t("Abra o Runflow no navegador do computador para usar esta parte."));
  try {
    await WebBrowser.openBrowserAsync(WEB_URL + path);
  } catch (e) {
    toast.error(e);
  }
}
