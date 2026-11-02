/** Hashtag editor for workouts: type "#limiar" or "limiar", Enter/space/comma adds; Backspace on empty removes the last. */
import { X } from "lucide-react";
import { useId, useState } from "react";
import { MAX_TAGS, cleanTags } from "@/domain/tags";
import { t } from "@/i18n";
import { cn } from "@/ui";

export function TagInput({ id, describedBy, value, onChange, suggestions = [] }: { id: string; describedBy?: string; value: string[]; onChange: (tags: string[]) => void; suggestions?: string[] }) {
  const listId = useId();
  const [draft, setDraft] = useState("");
  const full = value.length >= MAX_TAGS;
  const commit = (raw = draft) => { if (raw.trim()) onChange(cleanTags([...value, ...raw.split(/[\s,]+/)])); setDraft(""); };
  const remove = (tag: string) => onChange(value.filter((x) => x !== tag));
  const open = suggestions.filter((s) => !value.includes(s));
  return (
    <div className={cn("flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2 py-1.5 transition-colors",
      "focus-within:border-brand-ring focus-within:ring-3 focus-within:ring-brand-ring/25")}>
      {value.map((tag) => (
        <span key={tag} className="inline-flex h-7 items-center gap-0.5 rounded-full bg-sunken pl-2.5 pr-1 text-sm font-semibold text-fg">
          #{tag}
          <button type="button" onClick={() => remove(tag)} className="relative grid size-6 place-items-center rounded-full text-fg-muted hover:bg-soft hover:text-fg">
            <X className="size-3.5" /><span className="sr-only">{t("Remover #{tag}", { tag })}</span>
          </button>
        </span>
      ))}
      <input id={id} aria-describedby={describedBy} list={open.length ? listId : undefined} value={draft} disabled={full} autoComplete="off" enterKeyHint="done"
        placeholder={full ? t("Máximo de {n} tags", { n: MAX_TAGS }) : value.length ? t("Outra tag") : "#intervalado #pista"}
        onChange={(e) => { const v = e.target.value; if (/[\s,]$/.test(v)) commit(v); else setDraft(v); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          else if (e.key === "Backspace" && !draft && value.length) remove(value[value.length - 1]!);
        }}
        onBlur={() => commit()}
        className="h-7 min-w-32 flex-1 bg-transparent px-1 text-base text-fg placeholder:text-fg-subtle focus:outline-none disabled:opacity-60" />
      {open.length > 0 && <datalist id={listId}>{open.map((s) => <option key={s} value={s} />)}</datalist>}
    </div>
  );
}
