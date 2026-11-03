/**
 * O1 · Club Studio (owner; the web's screens/owner/Studio.tsx): the logo, 0–2 colors (D-014), the contrast report and
 * a live preview in light and dark. The engine keeps contrast; the white-text and swap suggestions help when a color
 * fights it. Colors suggested from the logo stay on the web (React Native can't read pixels). Changes wait in a save bar.
 */
import Color from "@runflow/design/color";
import { tokens } from "@runflow/design/tokens";
import { Image } from "expo-image";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSaveBranding, useUploadAsset } from "@/api/clubs";
import { fetchMe, meKey } from "@/api/me";
import { ClubLogo } from "@/components/brand";
import { ColorPicker, PRIMARY_PRESETS, SECONDARY_PRESETS } from "@/components/club/ColorPicker";
import { ContrastReport } from "@/components/club/ContrastReport";
import { ThemePreview } from "@/components/club/ThemePreview";
import { t } from "@/i18n";
import { ApiError, assetUrl } from "@/lib/api";
import { selectClub, useClub } from "@/lib/club";
import { pickLogo } from "@/lib/logo";
import { queryClient } from "@/queryClient";
import { useTheme } from "@/theme/ThemeProvider";
import { Button, Card, Screen, Text, toast } from "@/ui";
import { ArrowRightLeft, Check, ImageUp, Info, Palette, RotateCcw, Trash2 } from "@/ui/icons";

const DEFAULTS = { brand: tokens.seeds.brand, accent: tokens.seeds.accent };
const MODES = ["light", "dark"] as const;
/** The engine had to shift the color to make it work as a button somewhere (light or dark). */
const adjustedAsButton = (seed: string) => MODES.some((m) => Color.roles(seed, m, tokens.env[m]).meta.solidAdjusted);

export default function StudioScreen() {
  const { theme } = useTheme();
  const c = theme.color;
  const { ctx, club } = useClub();
  const saved = ctx?.branding ?? null;
  const [primary, setPrimary] = useState<string | null>(saved?.primary_color ?? null);
  const [secondary, setSecondary] = useState<string | null>(saved?.secondary_color ?? null);
  const [logo, setLogo] = useState<{ data_url: string; width: number; height: number } | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [busy, setBusy] = useState(false);
  const upload = useUploadAsset(club?.id ?? "");
  const save = useSaveBranding(club?.id ?? "");
  const res = useMemo(() => Color.resolveClubColors({ primary, secondary }, DEFAULTS), [primary, secondary]);
  if (!club) return null;

  const savedLogo = removeLogo ? null : saved?.logo_url ?? null;
  const previewLogo = logo?.data_url ?? assetUrl(savedLogo);
  const dirty = primary !== (saved?.primary_color ?? null) || secondary !== (saved?.secondary_color ?? null) || !!logo || removeLogo;
  const whiteVariant = primary ? Color.whiteTextVariant(primary) : null;
  // Root.md §4.4: if the secondary works better for buttons than the primary, suggest swapping them.
  const swap = primary && secondary && adjustedAsButton(primary) && !adjustedAsButton(secondary);
  const sourceText = { default: t("Sem cores: o app usa o padrão do Runflow."), derived: t("Uma cor: a secundária é criada automaticamente a partir dela."), club: t("Duas cores: primária para ações, secundária para destaques.") }[res.source];

  const pick = async () => {
    try {
      const r = await pickLogo();
      if (r) { setLogo(r); setRemoveLogo(false); }
    } catch {
      toast.error(new ApiError(415, "asset", t("Não conseguimos ler esta imagem"), t("Envie uma imagem PNG, JPG ou WebP.")));
    }
  };
  const reset = () => { setPrimary(saved?.primary_color ?? null); setSecondary(saved?.secondary_color ?? null); setLogo(null); setRemoveLogo(false); };
  const submit = async () => {
    setBusy(true);
    try {
      let logoId: string | null | undefined;
      if (logo) logoId = (await upload.mutateAsync({ ...logo, kind: "logo" })).id;
      else if (removeLogo) logoId = null;
      await save.mutateAsync({ primary_color: primary, secondary_color: secondary, ...(logoId !== undefined ? { logo_asset_id: logoId } : {}) });
      const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe });
      selectClub(me.memberships.find((m) => m.club.id === club.id) ?? null);
      setLogo(null); setRemoveLogo(false);
      toast.success(t("Visual do clube salvo"), t("Seus alunos já veem as novas cores."));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const box = theme.space[20];

  return (
    <View style={styles.fill}>
      <Screen>
        {/* The back bar says "Club Studio". */}
        <Text tone="muted">{t("Logo e cores do {club}. O Runflow cuida do contraste no modo claro e escuro.", { club: club.name })}</Text>
        <ThemePreview name={club.name} colors={{ primary, secondary }} logoUri={previewLogo} />
        <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
          <Text variant="titleSm" accessibilityRole="header">{t("Logo")}</Text>
          <View style={[styles.row, { gap: theme.space[4] }]}>
            <View style={[styles.center, { width: box, height: box, borderRadius: theme.radius.lg, backgroundColor: c.sunken, borderWidth: 1, borderColor: c.line, overflow: "hidden" }]}>
              {logo ? <Image source={{ uri: logo.data_url }} contentFit="contain" accessibilityLabel={t("Logo do clube")} style={{ width: box - theme.space[3], height: box - theme.space[3] }} />
                : savedLogo ? <ClubLogo club={club} branding={{ logo_url: savedLogo }} size={box - theme.space[2]} />
                : <ImageUp size={theme.size.iconLg} color={c.fgSubtle} aria-hidden />}
            </View>
            <View style={[styles.flex, { gap: theme.space[2] }]}>
              <Button variant="secondary" size="sm" icon={ImageUp} style={styles.start} onPress={() => void pick()}>{previewLogo ? t("Trocar logo") : t("Enviar logo")}</Button>
              {previewLogo ? (
                <Button variant="ghost" size="sm" icon={Trash2} style={styles.start} onPress={() => { setLogo(null); setRemoveLogo(!!saved?.logo_url); }}>{t("Remover")}</Button>
              ) : null}
              <Text variant="caption" tone="muted">{t("PNG ou JPG da sua galeria. Fundo transparente fica melhor.")}</Text>
            </View>
          </View>
        </Card>
        <Card style={{ padding: theme.space[4], gap: theme.space[5] }}>
          <Text variant="titleSm" accessibilityRole="header">{t("Cores")}</Text>
          <ColorPicker label={t("Cor primária: botões e destaques de ação")} value={primary} onChange={(v) => { setPrimary(v); if (!v) setSecondary(null); }} presets={PRIMARY_PRESETS} noneLabel={t("Padrão Runflow")} />
          <ColorPicker label={t("Cor secundária: recordes e conquistas")} value={secondary} onChange={setSecondary} presets={SECONDARY_PRESETS} noneLabel={t("Automática")} disabled={!primary} />
          <View style={{ gap: theme.space[1], padding: theme.space[3], borderRadius: theme.radius.md, backgroundColor: c.sunken }}>
            <View style={[styles.row, { gap: theme.space[2] }]}>
              <Palette size={theme.size.iconSm} color={c.fg} aria-hidden />
              <Text variant="labelSm" style={styles.flex}>{sourceText}</Text>
            </View>
            {whiteVariant ? (
              <>
                <Text variant="bodySm" tone="muted">{t("Para manter a leitura, os botões usam texto escuro nesta cor.")}</Text>
                <Button variant="ghost" size="sm" style={styles.start} onPress={() => setPrimary(whiteVariant)}>{t("Preferir texto branco ({c})", { c: whiteVariant })}</Button>
              </>
            ) : null}
            {swap ? (
              <>
                <Text variant="bodySm" tone="muted">{t("A cor secundária funciona melhor nos botões do que a primária.")}</Text>
                <Button variant="ghost" size="sm" icon={ArrowRightLeft} style={styles.start} onPress={() => { setPrimary(secondary); setSecondary(primary); }}>{t("Inverter as cores")}</Button>
              </>
            ) : null}
          </View>
        </Card>
        <ContrastReport primary={res.primary} secondary={res.secondary} />
        <View style={[styles.row, styles.top, { gap: theme.space[2] }]}>
          <Info size={theme.size.iconSm} color={c.fgMuted} aria-hidden style={{ marginTop: theme.space["0.5"] }} />
          <Text variant="bodySm" tone="muted" style={styles.flex}>{t("O Runflow é o app; o clube dá o tom. Cores de status, zonas e modalidades não mudam, para que todos leiam os dados do mesmo jeito.")}</Text>
        </View>
      </Screen>
      {dirty && (
        <View accessibilityRole="toolbar" accessibilityLabel={t("Alterações")}
          style={[styles.row, { gap: theme.space[2], paddingHorizontal: theme.space[4], paddingVertical: theme.space[3], backgroundColor: c.raised, borderTopWidth: 1, borderTopColor: c.line, boxShadow: theme.shadow.lg }]}>
          <Text variant="labelSm" style={styles.flex}>{t("Alterações não salvas")}</Text>
          <Button variant="ghost" icon={RotateCcw} onPress={reset}>{t("Descartar")}</Button>
          <Button icon={Check} loading={busy} onPress={() => void submit()}>{t("Salvar")}</Button>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center" },
  top: { alignItems: "flex-start" },
  center: { alignItems: "center", justifyContent: "center" },
  flex: { flex: 1, minWidth: 0 },
  start: { alignSelf: "flex-start" },
});
