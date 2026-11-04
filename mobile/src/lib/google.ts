/**
 * Native Google sign-in (X16): Google's SDK on the phone returns an ID token for the web OAuth client (the
 * `google_client_id` of /public/config), which the app sends to POST /auth/google like the web app does.
 *
 * Only builds with the native module have it (the QA APK, development builds), never Expo Go: importing the package
 * without its module throws, so it loads lazily behind a registry check and `googleAvailable()` is false there.
 * On Android, Google also needs an Android OAuth client in the same Google Cloud project with the app's package and
 * signing SHA-1 (setup-todo.md); without it the SDK answers DEVELOPER_ERROR ("unconfigured" here).
 * iOS needs the `iosUrlScheme` option of the config plugin in app.json before the first iOS build.
 */
import { TurboModuleRegistry } from "react-native";

type Lib = typeof import("@react-native-google-signin/google-signin");
let lib: Lib | null | undefined;

function load(): Lib | null {
  if (lib === undefined) {
    try {
      lib = TurboModuleRegistry.get("RNGoogleSignin") ? (require("@react-native-google-signin/google-signin") as Lib) : null;
    } catch {
      lib = null;
    }
  }
  return lib;
}

/** Whether this build can sign in with Google natively. */
export const googleAvailable = (): boolean => load() !== null;

export type GoogleResult =
  | { ok: true; idToken: string }
  | { ok: false; reason: "cancelled" | "unconfigured" | "no_play_services" | "unavailable" | "failed" };

/** Opens Google's account chooser and returns the ID token. Never throws. */
export async function googleIdToken(webClientId: string): Promise<GoogleResult> {
  const g = load();
  if (!g) return { ok: false, reason: "unavailable" };
  const { GoogleSignin, isErrorWithCode, isSuccessResponse, statusCodes } = g;
  try {
    GoogleSignin.configure({ webClientId });
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const r = await GoogleSignin.signIn();
    if (!isSuccessResponse(r)) return { ok: false, reason: "cancelled" };
    // Runflow keeps its own session: let go of Google's, so the account chooser shows again next time.
    GoogleSignin.signOut().catch(() => undefined);
    return r.data.idToken ? { ok: true, idToken: r.data.idToken } : { ok: false, reason: "failed" };
  } catch (e) {
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS) return { ok: false, reason: "cancelled" };
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return { ok: false, reason: "no_play_services" };
      // CommonStatusCodes.DEVELOPER_ERROR: no Android OAuth client matches this app's package and signing key.
      if (e.code === "10") return { ok: false, reason: "unconfigured" };
    }
    return { ok: false, reason: "failed" };
  }
}
