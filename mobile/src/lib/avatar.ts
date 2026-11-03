/**
 * The profile photo (C1): pick from the gallery with a square crop, shrink to ≤ 512 px like the web does, and hand
 * back what POST /me/avatar takes. Works in Expo Go and the web preview (no camera permission: gallery only).
 */
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

const MAX = 512;

/** null when the person closed the picker. Throws when the image can't be read. */
export async function pickAvatar(): Promise<{ data_url: string; width: number; height: number } | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 1 });
  if (r.canceled || !r.assets?.[0]) return null;
  const a = r.assets[0];
  const ctx = ImageManipulator.manipulate(a.uri, { maxWidth: MAX, maxHeight: MAX });
  const big = Math.max(a.width, a.height);
  if (big > MAX) ctx.resize(a.width >= a.height ? { width: MAX, height: null } : { width: null, height: MAX });
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ base64: true, compress: 0.85, format: SaveFormat.JPEG });
  if (!out.base64) throw new Error("avatar.encode");
  return { data_url: `data:image/jpeg;base64,${out.base64}`, width: out.width, height: out.height };
}
