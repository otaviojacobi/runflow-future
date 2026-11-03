/** YouTube / Vimeo links (the web's lib/video.ts): which provider, and YouTube's thumbnail. Anything else isn't shown. */
export function parseVideo(url: string | null | undefined): { provider: "youtube" | "vimeo"; id: string } | null {
  if (!url) return null;
  const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (yt) return { provider: "youtube", id: yt[1]! };
  const vm = /vimeo\.com\/(\d+)/.exec(url);
  return vm ? { provider: "vimeo", id: vm[1]! } : null;
}
export const thumbnailUrl = (url: string | null | undefined) => { const v = parseVideo(url); return v?.provider === "youtube" ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : null; };
