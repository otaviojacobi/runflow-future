import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useComments, usePostComment } from "@/api/my";
import { t } from "@/i18n";
import { ago } from "@/lib/format";
import { Avatar, Button, Skeleton, cn, toast } from "@/ui";

/** Conversation on a planned workout. `meMembershipId` aligns own messages to the right. */
export function Thread({ clubId, workoutId, meMembershipId, placeholder, quickReplies }: { clubId: string; workoutId: string; meMembershipId: string; placeholder?: string; quickReplies?: string[] }) {
  const list = useComments(clubId, workoutId);
  const post = usePostComment(clubId, workoutId);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [list.data?.length]);
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    post.mutate(text, { onSuccess: () => setText(""), onError: toast.error });
  };
  return (
    <div className="grid gap-3">
      {list.isPending ? <Skeleton className="h-16" /> : list.data?.length ? (
        <ul className="grid gap-3">
          {list.data.map((c) => {
            const mine = c.author_membership_id === meMembershipId;
            return (
              <li key={c.id} className={cn("flex items-end gap-2", mine && "flex-row-reverse")}>
                <Avatar name={c.author.user.name} src={c.author.user.avatar_url} size={28} />
                <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2", mine ? "rounded-br-sm bg-brand text-on-brand" : "rounded-bl-sm bg-soft text-fg")}>
                  {!mine && <div className="text-xs font-bold opacity-80">{c.author.user.name.split(" ")[0]}{c.author.role !== "student" ? ` · ${t("treinador(a)")}` : ""}</div>}
                  <p className="whitespace-pre-wrap text-[15px]">{c.body}</p>
                  <div className={cn("mt-0.5 text-[11px]", mine ? "opacity-80" : "text-fg-muted")}>{ago(c.created_at)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      ) : <p className="text-sm text-fg-muted">{t("Nenhuma mensagem ainda.")}</p>}
      <div ref={end} />
      {quickReplies && quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-1.5">{quickReplies.map((q) => <button key={q} type="button" disabled={post.isPending} onClick={() => post.mutate(q, { onError: toast.error })} className="rounded-full border border-line bg-surface px-3 py-1 text-sm hover:bg-soft disabled:opacity-50">{q}</button>)}</div>
      )}
      <form onSubmit={send} className="flex items-end gap-2">
        <textarea aria-label={t("Mensagem")} value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder={placeholder ?? t("Escreva uma mensagem")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(e); } }}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-line-strong bg-surface px-3.5 py-2 text-[15px] focus:border-brand-ring focus:outline-none focus:ring-3 focus:ring-brand-ring/25" />
        <Button type="submit" size="md" icon={<Send />} loading={post.isPending} disabled={!text.trim()} aria-label={t("Enviar")} className="rounded-full px-3" />
      </form>
    </div>
  );
}
