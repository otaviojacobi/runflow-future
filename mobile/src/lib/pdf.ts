/**
 * A PDF from HTML (reports, W16): expo-print renders it on the device and the share sheet hands it over (save to
 * Files/Drive, send, print). The web preview prints the HTML in a new window instead (pdf.web.ts).
 */
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

/** Resolves false when this device can't share files. */
export async function sharePdf(html: string, dialogTitle: string): Promise<boolean> {
  const { uri } = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync())) return false;
  await Sharing.shareAsync(uri, { mimeType: "application/pdf", dialogTitle, UTI: "com.adobe.pdf" });
  return true;
}
