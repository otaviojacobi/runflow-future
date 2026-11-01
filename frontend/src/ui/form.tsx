import { Switch as RSwitch } from "radix-ui";
import { ChevronDown, CircleAlert } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "./cn";

const CONTROL =
  "w-full rounded-md border border-line-strong bg-surface text-base text-fg placeholder:text-fg-subtle transition-colors focus:outline-none focus:border-brand-ring focus:ring-3 focus:ring-brand-ring/25 aria-[invalid=true]:border-danger aria-[invalid=true]:focus:ring-danger-ring/25 disabled:opacity-60";

/** Label + control + hint/error. Pass `children` as a render function to receive the generated id. */
export function Field({ label, hint, error, optional, children, className }: { label: ReactNode; hint?: ReactNode; error?: string | null; optional?: boolean; children: (id: string, describedBy?: string) => ReactNode; className?: string }) {
  const id = useId();
  const msg = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="rf-text-label-sm text-fg">
        {label} {optional && <span className="font-normal text-fg-muted">(opcional)</span>}
      </label>
      {children(id, msg)}
      {error ? (
        <p id={msg} className="flex items-center gap-1 rf-text-caption text-danger-text"><CircleAlert className="size-3.5 shrink-0" aria-hidden />{error}</p>
      ) : hint ? (
        <p id={msg} className="rf-text-caption text-fg-muted">{hint}</p>
      ) : null}
    </div>
  );
}
export function Input({ invalid, className, ...p }: { invalid?: boolean } & ComponentProps<"input">) {
  return <input aria-invalid={invalid || undefined} className={cn(CONTROL, "h-10 px-3", className)} {...p} />;
}
export function Textarea({ invalid, className, ...p }: { invalid?: boolean } & ComponentProps<"textarea">) {
  return <textarea aria-invalid={invalid || undefined} className={cn(CONTROL, "min-h-24 px-3 py-2", className)} {...p} />;
}
export function Select({ invalid, className, children, ...p }: { invalid?: boolean } & ComponentProps<"select">) {
  return (
    <div className="relative">
      <select aria-invalid={invalid || undefined} className={cn(CONTROL, "h-10 appearance-none pl-3 pr-9", className)} {...p}>{children}</select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" aria-hidden />
    </div>
  );
}
export function Checkbox({ label, description, className, ...p }: { label: ReactNode; description?: ReactNode } & Omit<ComponentProps<"input">, "type">) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-3", className)}>
      <input id={id} type="checkbox" className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-brand" {...p} />
      <span className="flex flex-col">
        <span className="text-[15px] font-medium text-fg">{label}</span>
        {description && <span className="rf-text-body-sm text-fg-muted">{description}</span>}
      </span>
    </label>
  );
}
export function Switch({ checked, onCheckedChange, label, description, disabled }: { checked: boolean; onCheckedChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <label htmlFor={id} className="flex cursor-pointer flex-col">
        <span className="text-[15px] font-medium text-fg">{label}</span>
        {description && <span className="rf-text-body-sm text-fg-muted">{description}</span>}
      </label>
      <RSwitch.Root id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled}
        className="relative h-7 w-12 shrink-0 cursor-pointer rounded-full bg-line-strong transition-colors data-[state=checked]:bg-brand disabled:opacity-50">
        <RSwitch.Thumb className="block size-6 translate-x-0.5 rounded-full bg-surface shadow-sm transition-transform duration-150 ease-standard data-[state=checked]:translate-x-[22px]" />
      </RSwitch.Root>
    </div>
  );
}
/** Segmented control (radio group). */
export function Segmented<T extends string>({ value, onChange, options, label, size = "md", className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: ReactNode }[]; label: string; size?: "sm" | "md"; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex gap-0.5 rounded-md bg-soft p-[3px]", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn("inline-flex flex-1 items-center justify-center gap-1.5 rounded-[8px] px-3 font-semibold text-fg-muted transition-colors [&_svg]:size-4",
            size === "sm" ? "h-7 text-[13px]" : "h-[34px] text-sm",
            value === o.value ? "bg-surface text-fg shadow-sm" : "hover:text-fg")}>
          {o.icon}{o.label}
        </button>
      ))}
    </div>
  );
}
