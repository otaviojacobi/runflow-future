/** Web preview: the browser's file picker; the picked File is read directly. */
import * as DocumentPicker from "expo-document-picker";

export async function pickTextFile(types: string[]): Promise<{ name: string; text: string } | null> {
  const r = await DocumentPicker.getDocumentAsync({ type: types, multiple: false });
  const a = r.canceled ? null : r.assets[0];
  if (!a?.file) return null;
  return { name: a.name, text: await a.file.text() };
}
