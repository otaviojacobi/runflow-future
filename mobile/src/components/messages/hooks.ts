/** Hooks shared by the Mensagens screens. */
import { useEffect, useRef, useState } from "react";

/**
 * Tab screens stay mounted when you leave them, and the Mensagens screens only poll while on screen: coming back
 * fetches what arrived meanwhile (not on the first mount, which fetches by itself).
 */
export function useRefetchOnFocus(focused: boolean, ...refetches: (() => unknown)[]) {
  const was = useRef(focused);
  useEffect(() => {
    if (focused && !was.current) refetches.forEach((r) => void r());
    was.current = focused;
  }, [focused]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** Pull to refresh: the spinner shows only for the person's pull, not for background polling. */
export function usePullToRefresh(...refetches: (() => Promise<unknown>)[]) {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    void Promise.allSettled(refetches.map((r) => r())).finally(() => setRefreshing(false));
  };
  return { refreshing, onRefresh };
}
