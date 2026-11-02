/** Web preview: localStorage (expo-sqlite on web needs wasm + COOP/COEP headers). Same synchronous API. */
export const storage = {
  get(key: string): string | null { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } },
  set(key: string, value: string | null) { try { if (value === null) globalThis.localStorage?.removeItem(key); else globalThis.localStorage?.setItem(key, value); } catch { /* private mode */ } },
};
