/**
 * The club logo (A5, O1): pick from the photo library, keep its shape and transparency, shrink to ≤ 512 px and hand
 * back what POST /clubs/{id}/assets takes. The web also suggests colors from the logo's pixels; React Native can't read
 * pixels without a native module, so on the phone the colors are picked by hand.
 */
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

const MAX = 512;

/** null when the person closed the picker. Throws when the image can't be read. */
export async function pickLogo(): Promise<{ data_url: string; width: number; height: number } | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1 });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const ctx = ImageManipulator.manipulate(a.uri);
  if (Math.max(a.width, a.height) > MAX) ctx.resize(a.width >= a.height ? { width: MAX, height: null } : { width: null, height: MAX });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ base64: true, format: SaveFormat.PNG });
  if (!out.base64) throw new Error("logo.encode");
  return { data_url: `data:image/png;base64,${out.base64}`, width: out.width, height: out.height };
}
