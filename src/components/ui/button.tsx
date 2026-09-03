import type { AnchorHTMLAttributes, ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  children: ReactNode;
  variant?: "solid" | "outline" | "text";
  showArrow?: boolean;
};

const variantClasses = {
  solid:
    "border-accent bg-accent text-accent-foreground hover:bg-foreground hover:border-foreground",
  outline:
    "border-border bg-transparent text-foreground hover:border-foreground hover:bg-foreground hover:text-background",
  text: "border-transparent px-0 text-foreground hover:text-accent",
} as const;

export function ButtonLink({
  children,
  className,
  showArrow = true,
  variant = "outline",
  ...props
}: ButtonLinkProps) {
  return (
    <a
      className={cn(
        "group inline-flex min-h-12 items-center justify-center gap-3 border px-5 text-xs font-semibold tracking-[0.12em] uppercase transition-colors duration-300",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      <span>{children}</span>
      {showArrow ? (
        <ArrowUpRight
          aria-hidden="true"
          className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
          strokeWidth={1.5}
        />
      ) : null}
    </a>
  );
}
