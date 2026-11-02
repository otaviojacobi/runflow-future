/** O1 · Club Studio: logo, 0–2 colors, contrast report, live previews (phone + desktop, light + dark). Route: /club/studio */
import Color, { type Mode, type Roles } from "@runflow/design/color";
import { tokens } from "@runflow/design/tokens";
import { Check, ImageUp, Info, Laptop, Moon, Palette, RotateCcw, Smartphone, Sparkles, Sun, Trash2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { readLogo, useSaveBranding, useUploadAsset } from "@/api/clubs";
import { fetchMe, meKey } from "@/api/me";
import { ClubLogo } from "@/components/brand";
import { ColorPicker, PRIMARY_PRESETS, SECONDARY_PRESETS } from "@/components/club/ColorPicker";
import { DesktopPreview } from "@/components/club/DesktopPreview";
import { ThemePreview } from "@/components/club/ThemePreview";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { selectClub, useClub } from "@/lib/club";
import { number } from "@/lib/format";
import { themeVars } from "@/lib/theme";
import { queryClient } from "@/queryClient";
import { Button, Card, PageHeader, Segmented, cn, toast } from "@/ui";

const DEFAULTS = { brand: tokens.seeds.brand, accent: tokens.seeds.accent };

/** Pixels of an already uploaded logo (same origin), for color suggestions. */
async function pixelsFromUrl(url: string): Promise<Uint8ClampedArray> {
  const img = await new Promise<HTMLImageElement>((ok, ko) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ko; i.src = url; });
  const s = Math.min(1, 256 / Math.max(img.naturalWidth || 256, img.naturalHeight || 256));
  const c = document.createElement("canvas");
  c.width = Math.round((img.naturalWidth || 256) * s); c.height = Math.round((img.naturalHeight || 256) * s);
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height).data;
}

export function StudioScreen() {
  const { ctx, club } = useClub();
  const saved = ctx?.branding ?? null;
  const [primary, setPrimary] = useState<string | null>(saved?.primary_color ?? null);
  const [secondary, setSecondary] = useState<string | null>(saved?.secondary_color ?? null);
  const [logo, setLogo] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [device, setDevice] = useState<"phone" | "desktop">("phone");
  const fileRef = useRef<HTMLInputElement>(null);
  const upload = useUploadAsset(club?.id ?? "");
  const save = useSaveBranding(club?.id ?? "");

  const res = useMemo(() => Color.resolveClubColors({ primary, secondary }, DEFAULTS), [primary, secondary]);
  const vars = useMemo(() => ({ light: themeVars({ primary, secondary }, "light"), dark: themeVars({ primary, secondary }, "dark") }), [primary, secondary]);
  if (!club) return null;

  const savedLogo = removeLogo ? null : saved?.logo_url ?? null;
  const logoUrl = logo?.dataUrl ?? savedLogo;
  const dirty = primary !== (saved?.primary_color ?? null) || secondary !== (saved?.secondary_color ?? null) || !!logo || removeLogo;
  const whiteVariant = primary ? Color.whiteTextVariant(primary) : null;
  const sourceText = { default: t("Sem cores: o app usa o padrão do Runflow."), derived: t("Uma cor: a secundária é criada automaticamente a partir dela."), club: t("Duas cores: primária para ações, secundária para destaques.") }[res.source];

  const pickSuggestions = (s: string[]) => { setSuggestions(s); if (s[0]) { setPrimary(s[0]); setSecondary(s[1] ?? null); } };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const r = await readLogo(f);
      setLogo(r); setRemoveLogo(false);
      pickSuggestions(Color.suggestFromPixels(r.pixels, 3));
    } catch (e) {
      toast.error(new ApiError(415, "asset", t("Não conseguimos ler esta imagem"), (e as Error).message === "size" ? t("O limite é 5 MB.") : t("Envie uma imagem PNG, JPG, WebP ou SVG.")));
    }
  };
  const suggestFromSaved = async () => {
    if (!saved?.logo_url) return;
    try { const s = Color.suggestFromPixels(await pixelsFromUrl(`/api${saved.logo_url}`), 3); if (s.length) pickSuggestions(s); else toast.info(t("Não achamos cores marcantes no logo"), t("Escolha nas opções abaixo.")); }
    catch { toast.info(t("Não conseguimos ler o logo"), t("Envie o arquivo de novo para sugerirmos as cores.")); }
  };
  const reset = () => { setPrimary(saved?.primary_color ?? null); setSecondary(saved?.secondary_color ?? null); setLogo(null); setRemoveLogo(false); setSuggestions([]); };
  const submit = async () => {
    try {
      let logoId: string | null | undefined;
      if (logo) logoId = (await upload.mutateAsync({ data_url: logo.dataUrl, width: logo.width, height: logo.height })).id;
      else if (removeLogo) logoId = null;
      await save.mutateAsync({ primary_color: primary, secondary_color: secondary, ...(logoId !== undefined ? { logo_asset_id: logoId } : {}) });
      const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
      selectClub(me.memberships.find((m) => m.club.id === club.id) ?? null);
      setLogo(null); setRemoveLogo(false);
      toast.success(t("Visual do clube salvo"), t("Seus alunos já veem as novas cores."));
    } catch (e) { toast.error(e); }
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-6 pb-24">
      <PageHeader title={t("Club Studio")} subtitle={t("Logo e cores do {club}. O Runflow cuida do contraste no modo claro e escuro.", { club: club.name })} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="grid content-start gap-6">
          <Card className="grid gap-4 p-5 sm:p-6">
            <h2 className="rf-text-title-md">{t("Logo")}</h2>
            <div className="flex flex-wrap items-center gap-4">
              <span className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl bg-sunken ring-1 ring-line">
                {logo ? <img src={logo.dataUrl} alt={t("Logo do clube")} className="size-full object-contain p-1.5" /> : savedLogo ? <ClubLogo club={club} branding={{ logo_url: savedLogo }} size={72} className="ring-0" /> : <ImageUp className="size-7 text-fg-subtle" />}
              </span>
              <div className="grid gap-2">
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" icon={<ImageUp />} onClick={() => fileRef.current?.click()}>{logoUrl ? t("Trocar logo") : t("Enviar logo")}</Button>
                  {saved?.logo_url && !logo && !removeLogo && <Button variant="ghost" size="sm" icon={<Sparkles />} onClick={suggestFromSaved}>{t("Sugerir cores do logo")}</Button>}
                  {logoUrl && <Button variant="ghost" size="sm" icon={<Trash2 />} onClick={() => { setLogo(null); setRemoveLogo(!!saved?.logo_url); }}>{t("Remover")}</Button>}
                </div>
                <span className="rf-text-caption text-fg-muted">{t("PNG, JPG, WebP ou SVG até 5 MB. Fundo transparente fica melhor.")}</span>
              </div>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" aria-label={t("Arquivo do logo")} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
            {suggestions.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm"><Sparkles className="size-4 text-accent-text" /><span className="text-fg-muted">{t("Do seu logo:")}</span>
                {suggestions.map((c) => <button key={c} type="button" onClick={() => setPrimary(c)} aria-pressed={primary === c} className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface pl-1 pr-2.5 font-mono text-xs hover:bg-soft aria-pressed:border-brand-ring"><span className="size-6 rounded-full ring-1 ring-inset ring-line-strong" style={{ background: c }} />{c}</button>)}
              </div>
            )}
          </Card>
          <Card className="grid gap-6 p-5 sm:p-6">
            <h2 className="rf-text-title-md">{t("Cores")}</h2>
            <ColorPicker label={t("Cor primária: botões e destaques de ação")} value={primary} onChange={(v) => { setPrimary(v); if (!v) setSecondary(null); }} presets={PRIMARY_PRESETS} noneLabel={t("Padrão Runflow")} />
            <ColorPicker label={t("Cor secundária: recordes e conquistas")} value={secondary} onChange={setSecondary} presets={SECONDARY_PRESETS} noneLabel={t("Automática")} disabled={!primary} />
            <div className="grid gap-1 rounded-md bg-sunken p-3 text-sm">
              <span className="flex items-center gap-2 font-semibold"><Palette className="size-4" />{sourceText}</span>
              {whiteVariant && <span className="text-fg-muted">{t("Para manter a leitura, os botões usam texto escuro nesta cor.")} <button type="button" className="font-semibold text-brand-text underline-offset-2 hover:underline" onClick={() => setPrimary(whiteVariant)}>{t("Preferir texto branco ({c})", { c: whiteVariant })}</button></span>}
            </div>
          </Card>
          <ContrastReport primary={res.primary} secondary={res.secondary} />
        </div>

        <div className="grid content-start gap-4 lg:sticky lg:top-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="rf-text-title-md">{t("Pré-visualização")}</h2>
            <Segmented label={t("Dispositivo")} value={device} onChange={setDevice} size="sm" options={[{ value: "phone", label: t("Celular"), icon: <Smartphone /> }, { value: "desktop", label: t("Computador"), icon: <Laptop /> }]} />
          </div>
          {device === "phone" ? (
            <div className="flex flex-wrap justify-center gap-4 rounded-xl bg-sunken p-4 sm:p-6">
              <figure className="grid justify-items-center gap-2"><ThemePreview name={club.name} logoUrl={logoUrl} mode="light" vars={vars.light} /><figcaption className="flex items-center gap-1 text-xs text-fg-muted"><Sun className="size-3.5" />{t("Claro")}</figcaption></figure>
              <figure className="grid justify-items-center gap-2"><ThemePreview name={club.name} logoUrl={logoUrl} mode="dark" vars={vars.dark} /><figcaption className="flex items-center gap-1 text-xs text-fg-muted"><Moon className="size-3.5" />{t("Escuro")}</figcaption></figure>
            </div>
          ) : (
            <div className="grid gap-4 rounded-xl bg-sunken p-4 sm:p-6">
              <figure className="grid gap-2"><DesktopPreview name={club.name} logoUrl={logoUrl} mode="light" vars={vars.light} /><figcaption className="flex items-center gap-1 text-xs text-fg-muted"><Sun className="size-3.5" />{t("Claro")}</figcaption></figure>
              <figure className="grid gap-2"><DesktopPreview name={club.name} logoUrl={logoUrl} mode="dark" vars={vars.dark} /><figcaption className="flex items-center gap-1 text-xs text-fg-muted"><Moon className="size-3.5" />{t("Escuro")}</figcaption></figure>
            </div>
          )}
          <p className="flex items-start gap-2 text-sm text-fg-muted"><Info className="mt-0.5 size-4 shrink-0" />{t("O Runflow é o app; o clube dá o tom. Cores de status, zonas e modalidades não mudam, para que todos leiam os dados do mesmo jeito.")}</p>
        </div>
      </div>

      <div className={cn("fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 border-t border-line bg-raised/95 px-4 py-3 shadow-lg backdrop-blur transition-transform lg:bottom-0 lg:left-[248px]", dirty ? "translate-y-0" : "invisible pointer-events-none translate-y-[200%]")} role="region" aria-label={t("Alterações")}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <span className="text-sm font-semibold">{t("Alterações não salvas")}</span>
          <div className="flex gap-2"><Button variant="ghost" icon={<RotateCcw />} onClick={reset}>{t("Descartar")}</Button><Button icon={<Check />} loading={upload.isPending || save.isPending} onClick={submit}>{t("Salvar visual")}</Button></div>
        </div>
      </div>
    </div>
  );
}

/** WCAG contrast of the generated roles in both modes. The engine guarantees the minimums; this shows the owner how. */
function ContrastReport({ primary, secondary }: { primary: string; secondary: string }) {
  const rows = useMemo(() => {
    const modes: Mode[] = ["light", "dark"];
    const of = (seed: string) => Object.fromEntries(modes.map((m) => [m, Color.roles(seed, m, tokens.env[m])])) as Record<Mode, Roles>;
    const p = of(primary), s = of(secondary);
    const env = tokens.env;
    return [
      { label: t("Texto nos botões"), min: 4.5, get: (m: Mode) => ({ v: p[m].meta.onSolidContrast, adj: false, a: p[m].solid, b: p[m].onSolid }) },
      { label: t("Botão sobre o fundo"), min: 3, get: (m: Mode) => ({ v: p[m].meta.solidVsCanvas, adj: p[m].meta.solidAdjusted, a: env[m].canvas, b: p[m].solid }) },
      { label: t("Links e textos na cor primária"), min: 4.5, get: (m: Mode) => ({ v: +Color.contrast(p[m].text, env[m].surface).toFixed(2), adj: p[m].meta.textAdjusted, a: env[m].surface, b: p[m].text }) },
      { label: t("Selos na cor secundária"), min: 4.5, get: (m: Mode) => ({ v: s[m].meta.onSolidContrast, adj: false, a: s[m].solid, b: s[m].onSolid }) },
      { label: t("Textos na cor secundária"), min: 4.5, get: (m: Mode) => ({ v: +Color.contrast(s[m].text, env[m].surface).toFixed(2), adj: s[m].meta.textAdjusted, a: env[m].surface, b: s[m].text }) },
    ];
  }, [primary, secondary]);
  const anyAdjusted = rows.some((r) => r.get("light").adj || r.get("dark").adj);
  return (
    <Card className="grid gap-3 p-5 sm:p-6">
      <div><h2 className="rf-text-title-md">{t("Contraste e leitura")}</h2><p className="text-sm text-fg-muted">{t("Medido pelo padrão WCAG. Mínimo de 4,5:1 para texto e 3:1 para botões.")}</p></div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-fg-muted"><th className="py-1.5 font-semibold">{t("Onde")}</th><th className="w-28 py-1.5 font-semibold"><span className="inline-flex items-center gap-1"><Sun className="size-3.5" />{t("Claro")}</span></th><th className="w-28 py-1.5 font-semibold"><span className="inline-flex items-center gap-1"><Moon className="size-3.5" />{t("Escuro")}</span></th></tr></thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="py-2 pr-2">{r.label}</td>
              {(["light", "dark"] as Mode[]).map((m) => { const x = r.get(m); const ok = x.v >= r.min; return (
                <td key={m} className="py-2">
                  <span className="inline-flex items-center gap-1.5 tabular-nums">
                    <span aria-hidden className="grid size-6 place-items-center rounded-[6px] text-[10px] font-bold ring-1 ring-inset ring-line" style={{ background: x.a, color: x.b }}>Aa</span>
                    {number(x.v, 1)}:1
                    {ok ? <Check className="size-4 text-success-text" aria-label={t("Aprovado")} /> : <Info className="size-4 text-warning-text" aria-label={t("Abaixo do mínimo")} />}
                    {x.adj && <sup className="text-info-text" title={t("Tom ajustado")}>*</sup>}
                  </span>
                </td>
              ); })}
            </tr>
          ))}
        </tbody>
      </table>
      {anyAdjusted && <p className="text-xs text-fg-muted"><span className="text-info-text">*</span> {t("Ajustamos o tom automaticamente neste modo para manter a leitura. A cor original continua no logo e nos destaques grandes.")}</p>}
    </Card>
  );
}
