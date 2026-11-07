/** W13 / M10 · Mensagens e mural. Staff: student conversations + mural; student: mural + conversation with the staff. Route: /messages (?c=<conversation id>) */
import { useNavigate } from "@tanstack/react-router";
import { MessageCircle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useConversations, useOpenConversation } from "@/api/messages";
import type { Club, ConversationSummary } from "@/api/types";
import { t } from "@/i18n";
import { useClub } from "@/lib/club";
import { ago } from "@/lib/format";
import { Avatar, Card, EmptyState, Input, PageHeader, Segmented, Skeleton, cn, toast } from "@/ui";
import { Chat } from "./Chat";
import { Mural } from "./Mural";

export function MessagesScreen() {
  const { club, ctx, isStaff } = useClub();
  if (!club || !ctx) return null;
  return isStaff ? <StaffMessages club={club} myId={ctx.membership.id} /> : <StudentMessages club={club} myId={ctx.membership.id} />;
}

function StaffMessages({ club, myId }: { club: Club; myId: string }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"chats" | "mural">("chats");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.search).get("c"));
  const list = useConversations(club.id, q);
  const start = useOpenConversation(club.id);
  useEffect(() => { if (location.search) navigate({ to: "/messages", replace: true }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const items = list.data ?? [];
  const current = items.find((c) => c.id === open);
  const pick = (c: ConversationSummary) => {
    if (c.id) return setOpen(c.id);
    start.mutate(c.student_membership_id, { onSuccess: (r) => setOpen(r.id), onError: toast.error });
  };
  const unread = items.reduce((n, c) => n + c.unread_count, 0);
  return (
    <div className="mx-auto grid max-w-6xl grid-cols-[minmax(0,1fr)] gap-4">
      <PageHeader title={t("Mensagens")} subtitle={t("Conversas com os alunos e o mural do clube")} />
      <Segmented label={t("Seção")} value={tab} onChange={setTab} className="w-fit" options={[{ value: "chats", label: unread ? t("Conversas ({n})", { n: unread }) : t("Conversas") }, { value: "mural", label: t("Mural") }]} />
      {tab === "mural" ? <div className="max-w-3xl"><Mural club={club} staff /></div> : (
        <Card className="grid h-[calc(100dvh-15rem)] min-h-[480px] grid-cols-[minmax(0,1fr)] overflow-hidden lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className={cn("flex min-h-0 flex-col border-line lg:border-r", open && "max-lg:hidden")} aria-label={t("Alunos")}>
            <div className="relative border-b border-line p-3"><Search className="pointer-events-none absolute left-6 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" /><Input aria-label={t("Buscar aluno")} placeholder={t("Buscar aluno")} value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-9" /></div>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {list.isPending ? <li className="p-3"><Skeleton className="h-40" /></li> : items.map((c) => (
                <li key={c.student_membership_id}>
                  <button type="button" onClick={() => pick(c)} aria-current={c.id === open || undefined} className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-soft", c.id && c.id === open && "bg-brand-soft/50")}>
                    <Avatar name={c.student.user.name} src={c.student.user.avatar_url} size={38} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2"><span className={cn("truncate text-sm", c.unread_count ? "font-bold" : "font-semibold")}>{c.student.user.name}</span>{c.last_message_at && <span className="ml-auto shrink-0 text-[11px] text-fg-subtle">{ago(c.last_message_at)}</span>}</span>
                      <span className={cn("block truncate text-sm", c.unread_count ? "text-fg" : "text-fg-muted")}>{c.last_message ? (c.last_message.deleted_at ? t("Mensagem apagada") : `${c.last_message.author_membership_id === myId ? t("Você: ") : ""}${c.last_message.body}`) : t("Começar conversa")}</span>
                    </span>
                    {c.unread_count > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-brand px-1.5 text-[11px] font-bold text-on-brand">{c.unread_count}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
          <div className={cn("min-h-0", !open && "max-lg:hidden")}>
            {open ? <Chat key={open} club={club} id={open} myId={myId} onBack={() => setOpen(null)}
              title={current ? <div className="flex items-center gap-2.5"><Avatar name={current.student.user.name} src={current.student.user.avatar_url} size={32} /><div className="min-w-0"><div className="truncate font-semibold">{current.student.user.name}</div><div className="text-xs text-fg-muted">{t("Toda a equipe do clube vê esta conversa")}</div></div></div> : <span className="font-semibold">{t("Conversa")}</span>} />
              : <div className="grid h-full place-items-center"><EmptyState icon={<MessageCircle />} title={t("Escolha um aluno")}>{t("As mensagens ficam juntas com o histórico de treinos do aluno.")}</EmptyState></div>}
          </div>
        </Card>
      )}
    </div>
  );
}

function StudentMessages({ club, myId }: { club: Club; myId: string }) {
  const [tab, setTab] = useState<"mural" | "chat">(() => (new URLSearchParams(location.search).get("c") ? "chat" : "mural"));
  const list = useConversations(club.id);
  const conv = list.data?.[0];
  const staffLabel = club.trainer_label === "professor" ? t("Professores") : t("Treinadores");
  return (
    <div className="mx-auto grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-4">
      <PageHeader title={t("Mensagens")} subtitle={club.name} />
      <Segmented label={t("Seção")} value={tab} onChange={setTab} className="w-fit" options={[{ value: "mural", label: t("Mural") }, { value: "chat", label: conv?.unread_count ? t("{who} ({n})", { who: staffLabel, n: conv.unread_count }) : staffLabel }]} />
      {tab === "mural" ? <Mural club={club} staff={false} /> : (
        <Card className="h-[calc(100dvh-17rem)] min-h-[420px] overflow-hidden">
          {!conv?.id ? <Skeleton className="m-4 h-40" /> : <Chat club={club} id={conv.id} myId={myId} title={<div><div className="font-semibold">{t("Equipe {club}", { club: club.name })}</div><div className="text-xs text-fg-muted">{t("Suas mensagens chegam para todos os treinadores do clube")}</div></div>} />}
        </Card>
      )}
    </div>
  );
}
