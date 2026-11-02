/** YouTube / Vimeo links → privacy-enhanced embed URL and thumbnail. Anything else is not embedded. */
export function parseVideo(url: string | null | undefined): { provider: "youtube" | "vimeo"; id: string } | null {
  if (!url) return null;
  const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/.exec(url);
  if (yt) return { provider: "youtube", id: yt[1]! };
  const vm = /vimeo\.com\/(\d+)/.exec(url);
  return vm ? { provider: "vimeo", id: vm[1]! } : null;
}
export const embedUrl = (url: string | null | undefined) => {
  const v = parseVideo(url);
  return !v ? null : v.provider === "youtube" ? `https://www.youtube-nocookie.com/embed/${v.id}?rel=0` : `https://player.vimeo.com/video/${v.id}?dnt=1`;
};
export const thumbnailUrl = (url: string | null | undefined) => { const v = parseVideo(url); return v?.provider === "youtube" ? `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` : null; };
