/** Motion helpers: animations use token durations/easings and stop when the OS asks for reduced motion. */
import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

/** The native driver isn't available in the web preview. */
export const nativeDriver = Platform.OS !== "web";

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduced(v)).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduced;
}
