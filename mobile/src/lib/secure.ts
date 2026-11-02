/** Session token in the OS keychain / keystore (root.md §7.4). */
import * as SecureStore from "expo-secure-store";

const KEY = "rf.session";
export const secure = {
  async getToken() { try { return await SecureStore.getItemAsync(KEY); } catch { return null; } },
  async setToken(token: string | null) { if (token) await SecureStore.setItemAsync(KEY, token); else await SecureStore.deleteItemAsync(KEY); },
};
