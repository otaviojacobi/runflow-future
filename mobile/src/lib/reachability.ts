/**
 * Whether the API answers, as the app last saw it. Any HTTP answer (even an error) means reachable; a request that
 * never got one (fetch threw: no network, DNS, TLS, the server down) means unreachable. No imports, so lib/api.ts can
 * report every request and lib/offline.ts can combine it with the OS's connection state without a cycle.
 */
type Listener = () => void;

let reachable = true;
let changedAt = 0;
const listeners = new Set<Listener>();

export const reachability = {
  /** True until a request fails without an answer, and again from the next answer on. */
  get: () => reachable,
  /** When it last flipped (ms since epoch; 0 = never). */
  changedAt: () => changedAt,
  mark(ok: boolean) {
    if (ok === reachable) return;
    reachable = ok;
    changedAt = Date.now();
    listeners.forEach((l) => l());
  },
  subscribe(l: Listener) {
    listeners.add(l);
    return () => { listeners.delete(l); };
  },
};
