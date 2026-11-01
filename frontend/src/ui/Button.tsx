import { Link, type LinkProps } from "@tanstack/react-router";
import { LoaderCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
export type ButtonSize = "sm" | "md" | "lg";
const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-on-brand border-brand-edge hover:bg-brand-hover active:bg-brand-active",
  secondary: "bg-surface text-fg border-line shadow-sm hover:bg-soft",
  ghost: "bg-transparent text-fg-muted border-transparent hover:bg-soft hover:text-fg",
  danger: "bg-danger text-on-danger border-danger-edge hover:bg-danger-hover active:bg-danger-active",
  accent: "bg-accent text-on-accent border-accent-edge hover:bg-accent-hover active:bg-accent-active",
};
const SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 gap-1.5 rf-text-label-sm [&_svg]:size-4",
  md: "h-10 px-4 gap-2 rf-text-label-md [&_svg]:size-[18px]",
  lg: "h-12 px-5 gap-2 rf-text-label-md text-base [&_svg]:size-5",
};
const ICON_SIZE: Record<ButtonSize, string> = { sm: "size-8 [&_svg]:size-4", md: "size-10 [&_svg]:size-5", lg: "size-12 [&_svg]:size-6" };
const BASE =
  "inline-flex items-center justify-center rounded-md border whitespace-nowrap select-none transition-colors duration-150 ease-standard active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", opts: { block?: boolean; icon?: boolean } = {}) {
  return cn(BASE, VARIANT[variant], opts.icon ? ICON_SIZE[size] : SIZE[size], opts.block && "w-full");
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; loading?: boolean; icon?: ReactNode; iconRight?: ReactNode };
export function Button({ variant, size, block, loading, icon, iconRight, children, className, disabled, type = "button", ...rest }: Common & ComponentProps<"button">) {
  return (
    <button type={type} className={cn(buttonClass(variant, size, { block }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <LoaderCircle className="animate-spin" aria-hidden /> : icon}
      {children}
      {iconRight}
    </button>
  );
}
/** Icon-only button: `label` is required (screen readers + tooltip). */
export function IconButton({ label, variant = "ghost", size = "md", children, className, type = "button", ...rest }: { label: string; variant?: ButtonVariant; size?: ButtonSize } & ComponentProps<"button">) {
  return (
    <button type={type} aria-label={label} title={label} className={cn(buttonClass(variant, size, { icon: true }), "px-0", className)} {...rest}>
      {children}
    </button>
  );
}
/** A router link styled as a button. */
export function ButtonLink({ variant, size, block, icon, iconRight, children, className, ...rest }: Common & LinkProps & { className?: string; children?: ReactNode }) {
  return (
    <Link className={cn(buttonClass(variant, size, { block }), className)} {...rest}>
      {icon}
      {children}
      {iconRight}
    </Link>
  );
}
