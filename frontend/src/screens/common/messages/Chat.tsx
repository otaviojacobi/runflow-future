/** Direct conversation between a student and the club staff, with day separators and "Visto" receipts. */
import { ArrowLeft, CheckCheck, SendHorizontal, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useConversation, useDeleteMessage, useMarkConversationRead, useSendMessage } from "@/api/messages";
import type { Club, ConversationDetail, Message } from "@/api/types";
import { t } from "@/i18n";
import { addDays, localDate, shortDate, timeOf, today as todayFn } from "@/lib/format";
import { Avatar, IconButton, Skeleton, cn, toast } from "@/ui";

const dayLabel = (d: string, today: string) => (d === today ? t("Hoje") : d === addDays(today, -1) ? t("Ontem") : shortDate(d));

export function Chat({ club, id, myId, onBack, title }: { club: Club; id: string; myId: string; onBack?: () => void; title: React.ReactNode }) {
  const c = useConversation(club.id, id);
  const read = useMarkConversationRead(club.id);
  const x = c.data;
  const lastId = x?.messages.at(-1)?.id;
  useEffect(() => { if (x && (x.unread_count > 0)) read.mutate(x.id); }, [x?.id, lastId]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("Conversa")}>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        {onBack && <IconButton label={t("Voltar")} size="sm" onClick={onBack} className="lg:hidden"><ArrowLeft /></IconButton>}
        <div className="min-w-0 flex-1">{title}</div>
      </header>
      {!x ? <div className="grid gap-3 p-4"><Skeleton className="h-12 w-2/3" /><Skeleton className="ml-auto h-12 w-1/2" /></div> : <Thread club={club} c={x} myId={myId} />}
      <Composer club={club} id={id} />
    </section>
  );
}

function Thread({ club, c, myId }: { club: Club; c: ConversationDetail; myId: string }) {
  const del = useDeleteMessage(club.id);
  const end = useRef<HTMLDivElement>(null);
  const today = todayFn(club.timezone);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [c.messages.length]);
  const groups = useMemo(() => {
    const m: [string, Message[]][] = [];
    for (const msg of c.messages) { const d = localDate(msg.created_at, club.timezone); if (m.at(-1)?.[0] !== d) m.push([d, []]); m.at(-1)![1].push(msg); }
    return m;
  }, [c.messages, club.timezone]);
  // "Visto" under my last message when another participant has read past it.
  const myLast = [...c.messages].reverse().find((m) => m.author_membership_id === myId && !m.deleted_at);
  const seenBy = myLast ? c.reads.filter((r) => r.last_read_at >= myLast.created_at) : [];
  const studentSide = myId === c.student_membership_id;
  if (!c.messages.length) return <div className="grid flex-1 place-items-center p-6 text-center text-fg-muted">{studentSide ? t("Mande uma mensagem para a equipe. Todos os treinadores do clube veem esta conversa.") : t("Nenhuma mensagem ainda. Diga oi!")}</div>;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" role="log" aria-live="polite">
      {groups.map(([d, list]) => (
        <div key={d} className="grid gap-1.5">
          <div className="my-2 text-center text-xs font-semibold text-fg-subtle"><span className="rounded-full bg-sunken px-2.5 py-1">{dayLabel(d, today)}</span></div>
          {list.map((m, i) => {
            const mine = m.author_membership_id === myId;
            const showAuthor = !mine && (i === 0 || list[i - 1]!.author_membership_id !== m.author_membership_id);
            return (
              <Fragment key={m.id}>
              <div className={cn("group flex items-end gap-2", mine ? "justify-end" : "justify-start")}>
                {!mine && <span className="w-7 shrink-0">{showAuthor && <Avatar name={m.author.user.name} src={m.author.user.avatar_url} size={28} />}</span>}
                {mine && !m.deleted_at && <IconButton size="sm" label={t("Apagar mensagem")} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100" onClick={() => del.mutate(m.id, { onError: toast.error })}><Trash2 /></IconButton>}
                <div className={cn("max-w-[78%] rounded-2xl px-3.5 py-2", mine ? "rounded-br-md bg-brand text-on-brand" : "rounded-bl-md border border-line bg-surface")}>
                  {showAuthor && <div className="mb-0.5 text-xs font-semibold text-brand-text">{m.author.user.name.split(" ")[0]}{m.author.role && m.author.role !== "student" ? ` · ${t(club.trainer_label === "professor" ? "professor(a)" : "treinador(a)")}` : ""}</div>}
                  {m.deleted_at ? <p className="text-sm italic opacity-70">{t("Mensagem apagada")}</p> : <p className="whitespace-pre-line break-words text-[15px]">{m.body}</p>}
                  <div className={cn("mt-0.5 text-right text-[11px] tabular-nums", mine ? "opacity-80" : "text-fg-subtle")}>{timeOf(m.created_at, club.timezone)}</div>
                </div>
              </div>
              {m.id === myLast?.id && seenBy.length > 0 && (
                <p className="-mt-0.5 flex items-center justify-end gap-1 text-xs text-fg-muted"><CheckCheck className="size-3.5 text-info-text" />{studentSide ? t("Visto por {names}", { names: seenBy.map((r) => r.user.name.split(" ")[0]).join(", ") }) : t("Visto")}</p>
              )}
              </Fragment>
            );
          })}
        </div>
      ))}
      <div ref={end} />
    </div>
  );
}

function Composer({ club, id }: { club: Club; id: string }) {
  const send = useSendMessage(club.id, id);
  const [body, setBody] = useState("");
  const submit = () => { const b = body.trim(); if (!b) return; send.mutate(b, { onSuccess: () => setBody(""), onError: toast.error }); };
  return (
    <form className="flex items-end gap-2 border-t border-line p-3" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <textarea aria-label={t("Mensagem")} value={body} onChange={(e) => setBody(e.target.value)} rows={1} maxLength={4000} placeholder={t("Escreva uma mensagem")}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
        className="max-h-40 min-h-11 flex-1 resize-none rounded-xl border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] text-fg placeholder:text-fg-subtle focus:border-brand-ring focus:outline-none focus:ring-3 focus:ring-brand-ring/25 [field-sizing:content]" />
      <IconButton type="submit" variant="primary" label={t("Enviar")} disabled={!body.trim() || send.isPending} className="size-11 rounded-full"><SendHorizontal /></IconButton>
    </form>
  );
}
