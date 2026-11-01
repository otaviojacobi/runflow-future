import { Dialog as RDialog, DropdownMenu } from "radix-ui";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "@/i18n";
import { cn } from "./cn";

/** Dialog: centered on desktop, bottom sheet on phones. */
export function Dialog({ open, onOpenChange, title, description, children, footer, size = "md", trigger }: { open?: boolean; onOpenChange?: (v: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; size?: "sm" | "md" | "lg" | "xl"; trigger?: ReactNode }) {
  const width = { sm: "sm:max-w-sm", md: "sm:max-w-lg", lg: "sm:max-w-2xl", xl: "sm:max-w-4xl" }[size];
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <RDialog.Trigger asChild>{trigger}</RDialog.Trigger>}
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-40 bg-overlay data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <RDialog.Content
          className={cn(
            "fixed z-50 flex max-h-[92dvh] w-full flex-col bg-raised text-fg shadow-lg focus:outline-none",
            "inset-x-0 bottom-0 rounded-t-xl pb-[env(safe-area-inset-bottom)] data-[state=open]:animate-[sheet-in_220ms_var(--rf-easing-standard)]",
            "sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:pb-0 sm:data-[state=open]:animate-[fade-in_150ms_ease-out]",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6">
            <div className="min-w-0">
              <RDialog.Title className="rf-text-title-lg">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-fg-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{title}</RDialog.Description>}
            </div>
            <RDialog.Close className="-mr-2 -mt-1 grid size-10 shrink-0 place-items-center rounded-md text-fg-muted hover:bg-soft hover:text-fg" aria-label={t("Fechar")}>
              <X className="size-5" />
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line-subtle px-5 py-4 sm:px-6">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
export const DialogClose = RDialog.Close;

export type MenuItem = { label: ReactNode; icon?: ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean } | "separator";
export function Menu({ trigger, items, align = "end" }: { trigger: ReactNode; items: MenuItem[]; align?: "start" | "end" }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} className="z-50 min-w-48 rounded-md border border-line-subtle bg-raised p-1 text-fg shadow-md">
          {items.map((it, i) =>
            it === "separator" ? (
              <DropdownMenu.Separator key={i} className="my-1 h-px bg-line-subtle" />
            ) : (
              <DropdownMenu.Item key={i} disabled={it.disabled} onSelect={it.onSelect}
                className={cn("flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-sm px-2.5 text-sm outline-none data-[disabled]:opacity-50 data-[highlighted]:bg-soft [&_svg]:size-4", it.danger ? "text-danger-text" : "text-fg")}>
                {it.icon}{it.label}
              </DropdownMenu.Item>
            ),
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
