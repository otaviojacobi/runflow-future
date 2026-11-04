/** Web preview: no native Google sign-in (the product is Android/iOS; the web app has its own Google button). */
import type { GoogleResult } from "./google";

export type { GoogleResult } from "./google";
export const googleAvailable = (): boolean => false;
export async function googleIdToken(_webClientId: string): Promise<GoogleResult> {
  return { ok: false, reason: "unavailable" };
}
