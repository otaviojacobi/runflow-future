/**
 * C1 · Dados pessoais: the profile photo (gallery, square, ≤ 512 px) and the person's data: full name, phone, birth
 * date, sex; the e-mail is how they sign in (read-only). PATCH /me, POST/DELETE /me/avatar.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRemoveAvatar, useUpdateMe, useUploadAvatar } from "@/api/account";
import type { User } from "@/api/types";
import { ConfirmDialog } from "@/components/account/parts";
import { brToIso, isoToBr, maskDate } from "@/components/account/inputs";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { pickAvatar } from "@/lib/avatar";
import { useClub } from "@/lib/club";
import { useTheme } from "@/theme/ThemeProvider";
import { Avatar, Button, Card, Field, Input, Screen, Select, toast } from "@/ui";
import { ImageUp, Trash2 } from "@/ui/icons";

type Sex = "" | NonNullable<User["sex"]>;
const SEX: { value: Sex; label: string }[] = [{ value: "", label: "Prefiro não informar" }, { value: "female", label: "Feminino" }, { value: "male", label: "Masculino" }, { value: "other", label: "Outro" }];

export default function PersonalScreen() {
  const { me } = useClub();
  return (
    <>
      {me && <Personal user={me.user} key={me.user.id} />}
    </>
  );
}

function Photo({ user }: { user: User }) {
  const { theme } = useTheme();
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const [picking, setPicking] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const pick = async () => {
    setPicking(true);
    try {
      const img = await pickAvatar();
      if (img) upload.mutate(img, { onSuccess: () => toast.success(t("Foto atualizada")), onError: toast.error });
    } catch {
      toast.error(new ApiError(415, "asset", t("Não conseguimos ler esta imagem"), t("Escolha uma foto PNG, JPG ou WebP.")));
    } finally {
      setPicking(false);
    }
  };
  return (
    <Card style={[styles.photo, { gap: theme.space[4], padding: theme.space[4] }]}>
      <Avatar name={user.name} src={user.avatar_url} size={theme.space[20]} />
      <View style={[styles.flex, { gap: theme.space[2] }]}>
        <Button variant="secondary" icon={ImageUp} loading={picking || upload.isPending} onPress={pick}>{user.avatar_url ? t("Trocar foto") : t("Enviar foto")}</Button>
        {user.avatar_url && <Button variant="ghost" icon={Trash2} onPress={() => setConfirm(true)}>{t("Remover foto")}</Button>}
      </View>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title={t("Remover sua foto?")} description={t("No lugar dela aparecem as suas iniciais.")}
        confirmLabel={t("Remover")} loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => { setConfirm(false); toast.success(t("Foto removida")); }, onError: (e) => { setConfirm(false); toast.error(e); } })} />
    </Card>
  );
}

function Personal({ user }: { user: User }) {
  const { theme } = useTheme();
  const update = useUpdateMe();
  const init = { name: user.name, phone: user.phone ?? "", birth: isoToBr(user.birth_date), sex: (user.sex ?? "") as Sex };
  const [v, setV] = useState(init);
  const [tried, setTried] = useState(false);
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const err = update.error instanceof ApiError ? update.error : null;
  const birthIso = v.birth ? brToIso(v.birth) : "";
  const nameError = tried && !v.name.trim() ? t("Informe seu nome completo.") : err?.fieldError("name");
  const birthError = tried && birthIso === null ? t("Use o formato dd/mm/aaaa, como 14/09/1988.") : err?.fieldError("birth_date");
  const submit = () => {
    setTried(true);
    if (!v.name.trim() || birthIso === null) return;
    update.mutate({ name: v.name.trim(), phone: v.phone.trim() || null, birth_date: birthIso || null, sex: v.sex || null }, {
      onSuccess: (me) => { setTried(false); setV({ name: me.user.name, phone: me.user.phone ?? "", birth: isoToBr(me.user.birth_date), sex: (me.user.sex ?? "") as Sex }); toast.success(t("Perfil salvo")); },
      onError: (e) => { if (!(e instanceof ApiError && e.errors.length)) toast.error(e); },
    });
  };
  return (
    <Screen>
      <Photo user={user} />
      <Card style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Field label={t("Nome completo")} error={nameError}>
          {(a) => <Input {...a} value={v.name} onChangeText={(name) => set({ name })} autoComplete="name" textContentType="name" autoCapitalize="words" returnKeyType="next" />}
        </Field>
        <Field label={t("Celular")} optional error={err?.fieldError("phone")}>
          {(a) => <Input {...a} value={v.phone} onChangeText={(phone) => set({ phone })} placeholder="(11) 91234-5678" keyboardType="phone-pad" autoComplete="tel" textContentType="telephoneNumber" />}
        </Field>
        <Field label={t("Nascimento")} optional error={birthError} hint={t("dd/mm/aaaa")}>
          {(a) => <Input {...a} value={v.birth} onChangeText={(t2) => set({ birth: maskDate(t2) })} placeholder="14/09/1988" keyboardType="number-pad" inputMode="numeric" maxLength={10} autoComplete="birthdate-full" />}
        </Field>
        <Field label={t("Sexo")} optional hint={t("Usado só para estimar zonas e calorias.")}>
          {(a) => <Select<Sex> {...a} value={v.sex} options={SEX.map((o) => ({ value: o.value, label: t(o.label) }))} onChange={(sex) => set({ sex })} />}
        </Field>
        <Field label={t("E-mail")} hint={t("É com ele que você entra.")}>
          {(a) => <Input {...a} value={user.email} readOnly />}
        </Field>
      </Card>
      <View style={{ gap: theme.space[2] }}>
        <Button size="lg" disabled={!dirty} loading={update.isPending} onPress={submit}>{t("Salvar")}</Button>
        {dirty && <Button variant="ghost" onPress={() => { setV(init); setTried(false); update.reset(); }}>{t("Descartar alterações")}</Button>}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  photo: { flexDirection: "row", alignItems: "center" },
  flex: { flex: 1, minWidth: 0 },
});
