/** C1 · Minha conta: profile + photo, appearance, connections, notifications, privacy (consents, export), clubs (leave), devices, delete account. Route: /account */
import { Link, useNavigate } from "@tanstack/react-router";
import { CalendarPlus, ChevronRight, Copy, Download, ImageUp, LogOut, Monitor, Moon, ShieldCheck, Smartphone, Sun, Trash2, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import {
  exportMyData, useCalendarFeed, useConsents, useCreateCalendarFeed, useRevokeCalendarFeed, useDeleteAccount, useGrantConsent, useLeaveClub, usePrefs, useRemoveAvatar, useRevokeConsent, useRevokeOtherSessions, useRevokeSession, useSessions, useUpdateMe, useUpdatePrefs, useUploadAvatar,
} from "@/api/account";
import { signOut } from "@/api/auth";
import { readLogo } from "@/api/clubs";
import { fetchMe, meKey } from "@/api/me";
import type { ConsentKind, MembershipContext, NotificationPrefs, User, UserSession } from "@/api/types";
import { ProviderConnections } from "@/components/account/StravaConnect";
import { ClubLogo } from "@/components/brand";
import { t } from "@/i18n";
import { ApiError } from "@/lib/api";
import { selectClub, useClub } from "@/lib/club";
import { ago, fullDate, localDate, today as todayFn } from "@/lib/format";
import { promptInstall, useInstall } from "@/lib/pwa";
import { getColorMode, setColorMode, type ColorMode } from "@/lib/theme";
import { queryClient } from "@/queryClient";
import { ROLE_LABEL } from "@/screens/clubs/Clubs";
import { Avatar, Badge, Button, Card, Dialog, Field, Input, PageHeader, Segmented, Select, Skeleton, Switch, toast } from "@/ui";

const Section = ({ id, title, description, children, edge }: { id: string; title: string; description?: string; children: React.ReactNode; edge?: "danger" }) => (
  <Card id={id} edge={edge} className="grid scroll-mt-24 gap-4 p-5 sm:p-6">
    <div><h2 className={edge ? "rf-text-title-md text-danger-text" : "rf-text-title-md"}>{title}</h2>{description && <p className="text-sm text-fg-muted">{description}</p>}</div>
    {children}
  </Card>
);

export function AccountScreen() {
  const { me, role } = useClub();
  if (!me) return null;
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <PageHeader title={t("Minha conta")} subtitle={me.user.email} />
      {role === "student" && (
        <Link to="/account/profile" className="flex items-center gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm hover:bg-soft">
          <span className="grid size-10 place-items-center rounded-full bg-brand-soft text-on-brand-soft"><UserRound className="size-5" /></span>
          <span className="min-w-0 flex-1"><span className="block font-semibold">{t("Perfil de atleta")}</span><span className="block text-sm text-fg-muted">{t("Objetivo, nível, provas recentes e suas zonas")}</span></span>
          <ChevronRight className="size-5 text-fg-muted" />
        </Link>
      )}
      <Profile user={me.user} key={me.user.id} />
      <Appearance />
      <InstallApp />
      <Section id="connections" title={t("Relógios e apps")} description={t("Seus treinos chegam sozinhos. Desconectar apaga os dados importados.")}><ProviderConnections /></Section>
      <Notifications />
      {role === "student" && <CalendarFeed />}
      <Privacy memberships={me.memberships} />
      <Clubs memberships={me.memberships} />
      <Devices />
      <DeleteAccount />
    </div>
  );
}

function Profile({ user }: { user: User }) {
  const update = useUpdateMe();
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const fileRef = useRef<HTMLInputElement>(null);
  const init = { name: user.name, phone: user.phone ?? "", birth_date: user.birth_date ?? "", sex: user.sex ?? "" };
  const [v, setV] = useState(init);
  const set = (p: Partial<typeof v>) => setV((o) => ({ ...o, ...p }));
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const err = update.error instanceof ApiError ? update.error : null;
  const onFile = async (f?: File) => {
    if (!f) return;
    try { const r = await readLogo(f); upload.mutate({ data_url: r.dataUrl, width: r.width, height: r.height }, { onSuccess: () => toast.success(t("Foto atualizada")), onError: toast.error }); }
    catch { toast.error(new ApiError(415, "asset", t("Não conseguimos ler esta imagem"), t("Envie uma foto PNG, JPG ou WebP de até 5 MB."))); }
  };
  return (
    <Section id="profile" title={t("Perfil")}>
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={user.name} src={user.avatar_url} size={72} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<ImageUp />} loading={upload.isPending} onClick={() => fileRef.current?.click()}>{user.avatar_url ? t("Trocar foto") : t("Enviar foto")}</Button>
          {user.avatar_url && <Button variant="ghost" size="sm" icon={<Trash2 />} loading={remove.isPending} onClick={() => remove.mutate(undefined, { onSuccess: () => toast.success(t("Foto removida")) })}>{t("Remover")}</Button>}
        </div>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" aria-label={t("Arquivo da foto")} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); update.mutate({ name: v.name, phone: v.phone || null, birth_date: v.birth_date || null, sex: (v.sex || null) as User["sex"] }, { onSuccess: () => toast.success(t("Perfil salvo")) }); }}>
        <Field label={t("Nome")} error={err?.fieldError("name")} className="sm:col-span-2">{(id) => <Input id={id} value={v.name} onChange={(e) => set({ name: e.target.value })} autoComplete="name" />}</Field>
        <Field label={t("Celular")} optional>{(id) => <Input id={id} type="tel" value={v.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="(11) 91234-5678" autoComplete="tel" />}</Field>
        <Field label={t("Nascimento")} optional error={err?.fieldError("birth_date")}>{(id) => <Input id={id} type="date" value={v.birth_date} onChange={(e) => set({ birth_date: e.target.value })} />}</Field>
        <Field label={t("Sexo")} optional hint={t("Usado só para estimar zonas e calorias.")}>{(id, d) => <Select id={id} aria-describedby={d} value={v.sex} onChange={(e) => set({ sex: e.target.value })}><option value="">{t("Prefiro não informar")}</option><option value="female">{t("Feminino")}</option><option value="male">{t("Masculino")}</option><option value="other">{t("Outro")}</option></Select>}</Field>
        <Field label={t("E-mail")} hint={t("É com ele que você entra.")}>{(id, d) => <Input id={id} aria-describedby={d} value={user.email} readOnly disabled />}</Field>
        <div className="flex justify-end gap-2 sm:col-span-2">{dirty && <Button variant="ghost" onClick={() => setV(init)}>{t("Descartar")}</Button>}<Button type="submit" disabled={!dirty} loading={update.isPending}>{t("Salvar")}</Button></div>
      </form>
    </Section>
  );
}

function Appearance() {
  const [mode, setMode] = useState<ColorMode>(getColorMode());
  return (
    <Section id="appearance" title={t("Aparência")} description={t("As cores do clube se adaptam aos dois modos.")}>
      <Segmented label={t("Tema")} value={mode} onChange={(m) => { setMode(m); setColorMode(m); }} className="w-fit"
        options={[{ value: "light", label: t("Claro"), icon: <Sun /> }, { value: "dark", label: t("Escuro"), icon: <Moon /> }, { value: "system", label: t("Sistema"), icon: <Monitor /> }]} />
    </Section>
  );
}

function InstallApp() {
  const mode = useInstall();
  if (!mode) return null;
  return (
    <Section id="install" title={t("Runflow na tela inicial")} description={t("Abra como um app, mais rápido, e veja o treino do dia mesmo sem internet.")}>
      {mode === "prompt" ? <Button className="justify-self-start" icon={<Smartphone />} onClick={() => promptInstall().then((ok) => ok && toast.success(t("App instalado")))}>{t("Instalar o Runflow")}</Button>
        : <p className="text-sm">{t("No iPhone: toque em Compartilhar e depois em “Adicionar à Tela de Início”.")}</p>}
    </Section>
  );
}

function Notifications() {
  const prefs = usePrefs();
  const update = useUpdatePrefs();
  const p = prefs.data;
  const rows: { k: keyof Omit<NotificationPrefs, "user_id">; label: string; description: string }[] = [
    { k: "push_workouts", label: t("Treinos"), description: t("Treino novo ou alterado pelo treinador") },
    { k: "push_comments", label: t("Comentários"), description: t("Respostas nos seus treinos e feedbacks") },
    { k: "push_classes", label: t("Aulas"), description: t("Lembrete antes da aula, cancelamentos e vaga liberada na fila") },
    { k: "email_weekly", label: t("Resumo semanal por e-mail"), description: t("Toda segunda, como foi a semana") },
  ];
  return (
    <Section id="notifications" title={t("Notificações")} description={t("Avisos no celular e por e-mail. A central de notificações do app sempre mostra tudo.")}>
      {!p ? <Skeleton className="h-40" /> : <div className="grid gap-4">{rows.map((r) => <Switch key={r.k} label={r.label} description={r.description} checked={p[r.k]} onCheckedChange={(v) => update.mutate({ [r.k]: v }, { onError: toast.error })} />)}</div>}
    </Section>
  );
}

function CalendarFeed() {
  const feed = useCalendarFeed();
  const create = useCreateCalendarFeed(), revoke = useRevokeCalendarFeed();
  const [link, setLink] = useState<{ url: string; webcal_url: string } | null>(null);
  const copy = (u: string) => navigator.clipboard?.writeText(u).then(() => toast.success(t("Link copiado")));
  return (
    <Section id="calendar" title={t("Agenda no celular")} description={t("Seus treinos, aulas reservadas e provas no Google Agenda ou no Calendário do iPhone, atualizados sozinhos.")}>
      {link ? (
        <div className="grid gap-3">
          <div className="flex items-center gap-2"><Input readOnly value={link.url} aria-label={t("Link do calendário")} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} /><Button variant="secondary" icon={<Copy />} onClick={() => copy(link.url)}>{t("Copiar")}</Button></div>
          <div className="flex flex-wrap gap-2"><a href={link.webcal_url} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold hover:bg-soft"><CalendarPlus className="size-4" />{t("Abrir no Calendário (iPhone/Mac)")}</a><a href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(link.webcal_url)}`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold hover:bg-soft"><CalendarPlus className="size-4" />{t("Adicionar ao Google Agenda")}</a></div>
          <p className="text-xs text-fg-muted">{t("Este link é pessoal: quem tiver ele vê seus treinos. Se vazar, gere um novo.")}</p>
        </div>
      ) : feed.data?.active ? (
        <p className="text-sm text-fg-muted">{t("Calendário ativo desde {d}. Por segurança, o link só aparece quando é criado.", { d: fullDate(localDate(feed.data.created_at!)) })}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button variant={feed.data?.active ? "secondary" : "primary"} icon={<CalendarPlus />} loading={create.isPending} onClick={() => create.mutate(undefined, { onSuccess: (r) => setLink(r), onError: toast.error })}>{feed.data?.active ? t("Gerar novo link") : t("Criar link do calendário")}</Button>
        {feed.data?.active && <Button variant="ghost" loading={revoke.isPending} onClick={() => revoke.mutate(undefined, { onSuccess: () => { setLink(null); toast.success(t("Link desativado")); } })}>{t("Desativar")}</Button>}
      </div>
    </Section>
  );
}

function Privacy({ memberships }: { memberships: MembershipContext[] }) {
  const consents = useConsents();
  const grant = useGrantConsent(), revoke = useRevokeConsent();
  const [exporting, setExporting] = useState(false);
  const active = (kind: ConsentKind, clubId: string | null) => consents.data?.find((c) => c.kind === kind && c.club_id === clubId && !c.revoked_at);
  const terms = active("terms", null), privacy = active("privacy", null);
  const studentClubs = memberships.filter((m) => m.membership.role === "student");
  const toggle = (kind: ConsentKind, clubId: string, on: boolean) => {
    const c = active(kind, clubId);
    if (on) grant.mutate({ kind, club_id: clubId }, { onSuccess: () => toast.success(t("Compartilhamento ativado")), onError: toast.error });
    else if (c) revoke.mutate(c.id, { onSuccess: () => toast.success(t("Compartilhamento desativado"), t("O clube deixa de ver esses dados a partir de agora.")), onError: toast.error });
  };
  const download = async () => {
    setExporting(true);
    try {
      const data = await exportMyData();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: `runflow-meus-dados-${todayFn()}.json` });
      a.click(); URL.revokeObjectURL(url);
      toast.success(t("Seus dados foram baixados"));
    } catch (e) { toast.error(e); } finally { setExporting(false); }
  };
  return (
    <Section id="privacy" title={t("Privacidade")} description={t("Você decide o que cada clube vê. Pela LGPD, pode baixar ou apagar seus dados quando quiser.")}>
      {consents.isPending ? <Skeleton className="h-24" /> : studentClubs.map((m) => (
        <div key={m.club.id} className="grid gap-3 rounded-lg border border-line-subtle p-4">
          <div className="flex items-center gap-2"><ClubLogo club={m.club} branding={m.branding} size={24} /><span className="font-semibold">{m.club.name}</span></div>
          <Switch label={t("Compartilhar meus treinos")} description={t("Treinadores veem atividades, ritmo e frequência cardíaca dos treinos")} checked={!!active("share_training_data", m.club.id)} onCheckedChange={(v) => toggle("share_training_data", m.club.id, v)} />
          <Switch label={t("Incluir atividades do Strava")} description={t("Exigido pelo Strava para mostrar seus dados a outras pessoas")} checked={!!active("share_strava", m.club.id)} onCheckedChange={(v) => toggle("share_strava", m.club.id, v)} />
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line-subtle pt-4">
        <p className="flex items-center gap-2 text-sm text-fg-muted"><ShieldCheck className="size-4 shrink-0" />{terms && privacy ? t("Termos e política de privacidade aceitos em {d}", { d: fullDate(localDate(terms.granted_at)) }) : t("Termos e política de privacidade")}</p>
        <Button variant="secondary" icon={<Download />} loading={exporting} onClick={download}>{t("Baixar meus dados")}</Button>
      </div>
    </Section>
  );
}

function Clubs({ memberships }: { memberships: MembershipContext[] }) {
  const { club } = useClub();
  const leave = useLeaveClub();
  const navigate = useNavigate();
  const [target, setTarget] = useState<MembershipContext | null>(null);
  const confirm = () => target && leave.mutate(target.club.id, {
    onSuccess: async () => {
      const me = await queryClient.fetchQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 0 });
      toast.success(t("Você saiu de {club}", { club: target.club.name }));
      setTarget(null);
      if (target.club.id === club?.id) { selectClub(me.memberships[0] ?? null); navigate({ to: "/clubs" }); }
    },
    onError: (e) => { setTarget(null); toast.error(e); },
  });
  return (
    <Section id="clubs" title={t("Clubes")}>
      <ul className="divide-y divide-line-subtle">
        {memberships.map((m) => (
          <li key={m.club.id} className="flex items-center gap-3 py-2.5">
            <ClubLogo club={m.club} branding={m.branding} size={36} />
            <div className="min-w-0 flex-1"><div className="truncate font-semibold">{m.club.name}</div><div className="text-sm text-fg-muted">{t(ROLE_LABEL[m.membership.role])} · {t("desde {d}", { d: fullDate(localDate(m.membership.joined_at)) })}</div></div>
            <Button variant="ghost" size="sm" icon={<LogOut />} onClick={() => setTarget(m)}>{t("Sair")}</Button>
          </li>
        ))}
      </ul>
      <Dialog open={!!target} onOpenChange={(v) => !v && setTarget(null)} size="sm" title={t("Sair de {club}?", { club: target?.club.name ?? "" })}
        description={target?.membership.role === "student" ? t("Você deixa de receber treinos, suas reservas de aulas são canceladas e o clube perde acesso aos seus dados. Suas atividades continuam na sua conta.") : t("Você perde acesso aos alunos e treinos do clube.")}
        footer={<><Button variant="ghost" onClick={() => setTarget(null)}>{t("Voltar")}</Button><Button variant="danger" loading={leave.isPending} onClick={confirm}>{t("Sair do clube")}</Button></>} />
    </Section>
  );
}

const deviceName = (s: UserSession) => {
  if (s.kind === "mobile") return t("App Runflow");
  const ua = s.user_agent ?? "";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : t("Navegador");
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iPhone" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? t("{b} no {o}", { b: browser, o: os }) : browser;
};

function Devices() {
  const list = useSessions();
  const revoke = useRevokeSession(), others = useRevokeOtherSessions();
  const n = (list.data ?? []).filter((s) => !s.current).length;
  return (
    <Section id="devices" title={t("Aparelhos conectados")} description={t("Onde sua conta está aberta agora.")}>
      {list.isPending ? <Skeleton className="h-20" /> : (
        <ul className="divide-y divide-line-subtle">
          {(list.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2.5">
              <span className="grid size-9 place-items-center rounded-lg bg-soft text-fg-muted">{s.kind === "mobile" ? <Smartphone className="size-4" /> : <Monitor className="size-4" />}</span>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2 font-semibold">{deviceName(s)}{s.current && <Badge tone="success">{t("Este aparelho")}</Badge>}</div><div className="text-sm text-fg-muted">{t("Ativo {a}", { a: ago(s.last_seen_at) })}</div></div>
              {!s.current && <Button variant="ghost" size="sm" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id, { onSuccess: () => toast.success(t("Sessão encerrada")) })}>{t("Encerrar")}</Button>}
            </li>
          ))}
        </ul>
      )}
      {n > 0 && <Button variant="secondary" className="justify-self-start" loading={others.isPending} onClick={() => others.mutate(undefined, { onSuccess: (r) => toast.success(t("Saímos dos outros aparelhos"), t("{n} sessão(ões) encerrada(s).", { n: r.revoked })) })}>{t("Sair de todos os outros")}</Button>}
    </Section>
  );
}

function DeleteAccount() {
  const del = useDeleteAccount();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const WORD = t("EXCLUIR");
  return (
    <Section id="delete" title={t("Excluir conta")} edge="danger" description={t("Apaga seu perfil, atividades e conexões. Os clubes deixam de ver seus dados. Não dá para desfazer.")}>
      <Button variant="danger" className="justify-self-start" icon={<Trash2 />} onClick={() => setOpen(true)}>{t("Excluir minha conta")}</Button>
      <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setWord(""); }} size="sm" title={t("Excluir sua conta?")} description={t("Digite {w} para confirmar.", { w: WORD })}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>{t("Voltar")}</Button><Button variant="danger" disabled={word.trim().toUpperCase() !== WORD} loading={del.isPending}
          onClick={() => del.mutate(undefined, { onSuccess: async () => { await signOut(); navigate({ to: "/" }); toast.success(t("Conta excluída"), t("Sentiremos sua falta.")); }, onError: (e) => { setOpen(false); toast.error(e); } })}>{t("Excluir para sempre")}</Button></>}>
        <Input aria-label={t("Confirmação")} value={word} onChange={(e) => setWord(e.target.value)} placeholder={WORD} autoComplete="off" />
      </Dialog>
    </Section>
  );
}
