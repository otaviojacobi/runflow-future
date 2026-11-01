import { useMutation, useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryClient } from "@/queryClient";
import { meKey } from "./me";
import type { Branding, Club, Invitation, Membership, PublicInvite, Sport, Subscription } from "./types";

export const clubKeys = {
  invites: (clubId: string) => ["clubs", clubId, "invites"] as const,
  branding: (clubId: string) => ["clubs", clubId, "branding"] as const,
  publicInvite: (token: string) => ["public-invite", token] as const,
};

export const useCreateClub = () =>
  useMutation({
    mutationFn: (v: { name: string; city: string; state: string; modalities: Sport[] }) =>
      api.post<{ club: Club; membership: Membership; branding: Branding; subscription: Subscription }>("/clubs", v),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }),
  });
export const useUpdateClub = (clubId: string) =>
  useMutation({ mutationFn: (v: Partial<Club>) => api.patch<Club>(`/clubs/${clubId}`, v), onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }) });

export const useSaveBranding = (clubId: string) =>
  useMutation({
    mutationFn: (v: { primary_color: string | null; secondary_color: string | null; logo_asset_id?: string | null }) => api.put<Branding>(`/clubs/${clubId}/branding`, v),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: meKey }); queryClient.invalidateQueries({ queryKey: clubKeys.branding(clubId) }); },
  });
export const useUploadAsset = (clubId: string) =>
  useMutation({ mutationFn: (v: { data_url: string; width: number; height: number; kind?: "logo" | "avatar" }) => api.post<{ id: string; url: string }>(`/clubs/${clubId}/assets`, v) });

export const useInvites = (clubId: string | undefined) =>
  useQuery({ queryKey: clubKeys.invites(clubId ?? ""), enabled: !!clubId, queryFn: () => api.get<{ items: Invitation[] }>(`/clubs/${clubId}/invites`).then((r) => r.items) });
export const useCreateInvite = (clubId: string) =>
  useMutation({ mutationFn: (v: { role: "student" | "trainer"; max_uses?: number | null }) => api.post<Invitation>(`/clubs/${clubId}/invites`, v), onSuccess: () => queryClient.invalidateQueries({ queryKey: clubKeys.invites(clubId) }) });
export const useRevokeInvite = (clubId: string) =>
  useMutation({ mutationFn: (id: string) => api.del(`/clubs/${clubId}/invites/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: clubKeys.invites(clubId) }) });

export const usePublicInvite = (token: string) => useQuery({ queryKey: clubKeys.publicInvite(token), queryFn: () => api.get<PublicInvite>(`/public/invites/${token}`), retry: false });
export const useAcceptInvite = () =>
  useMutation({ mutationFn: (token: string) => api.post<{ membership: Membership; club: Club; already_member: boolean }>(`/invites/${token}/accept`), onSuccess: () => queryClient.invalidateQueries({ queryKey: meKey }) });

/** Read an image file, downscale to ≤ 512 px, return a PNG data URL + the pixels for color suggestions. */
export async function readLogo(file: File): Promise<{ dataUrl: string; width: number; height: number; pixels: Uint8ClampedArray }> {
  if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type)) throw new Error("type");
  if (file.size > 5 * 1024 * 1024) throw new Error("size");
  const src = await new Promise<string>((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = ko; r.readAsDataURL(file); });
  const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = src; });
  const w0 = img.naturalWidth || 512, h0 = img.naturalHeight || 512;
  const scale = Math.min(1, 512 / Math.max(w0, h0));
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL("image/png"), width: w, height: h, pixels: ctx.getImageData(0, 0, w, h).data };
}
