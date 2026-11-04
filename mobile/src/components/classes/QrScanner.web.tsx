/** The web preview has no camera scanner: the check-in sheet offers the typed code only. */
export const scannerAvailable = false;

export function QrScanner(_: { onScan: (data: string) => void }) {
  return null;
}
