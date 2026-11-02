/**
 * Small synchronous key-value store (native: expo-sqlite kv-store, works in Expo Go).
 * Synchronous on purpose: the club theme is read before the first frame (root.md §7.8).
 */
import Storage from "expo-sqlite/kv-store";

export const storage = {
  get(key: string): string | null { try { return Storage.getItemSync(key); } catch { return null; } },
  set(key: string, value: string | null) { try { if (value === null) Storage.removeItemSync(key); else Storage.setItemSync(key, value); } catch { /* storage full or unavailable: the app still works */ } },
};
