/** Web preview only: there is no keychain in the browser, so the token lives in localStorage. */
import { storage } from "./storage";

const KEY = "rf.session";
export const secure = {
  async getToken() { return storage.get(KEY); },
  async setToken(token: string | null) { storage.set(KEY, token); },
};
