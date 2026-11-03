/** Picking a text file (a CSV of students, O2): the system document picker, read from the app's cache copy. The web
 * preview reads the browser's File (textfile.web.ts). */
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";

/** null when the person closed the picker. */
export async function pickTextFile(types: string[]): Promise<{ name: string; text: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a) return null;
  return { name: a.name, text: await new File(a.uri).text() };
}
