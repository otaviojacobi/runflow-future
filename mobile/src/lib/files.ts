/**
 * Handing the person a file (LGPD data export, a .FIT workout): written to the app's cache and offered through the
 * system share sheet, so they can save it to Files/Drive or send it anywhere. The web preview downloads it (files.web.ts).
 */
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

/** Writes `text` to `name` and opens the share sheet. Resolves false when this device can't share files. */
export async function shareTextFile(name: string, text: string, mimeType: string, dialogTitle: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle, UTI: mimeType === "application/json" ? "public.json" : undefined });
  return true;
}

/** Writes `bytes` to `name` (a .FIT workout) and opens the share sheet. Resolves false when this device can't share. */
export async function shareBinaryFile(name: string, bytes: Uint8Array, mimeType: string, dialogTitle: string): Promise<boolean> {
  if (!(await Sharing.isAvailableAsync())) return false;
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  await file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle });
  return true;
}
