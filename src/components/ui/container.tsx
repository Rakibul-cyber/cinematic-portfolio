import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type ContainerProps = HTMLAttributes<HTMLDivElement>;

export function Container({ className, ...props }: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full max-w-[var(--container)] px-5 sm:px-8 lg:px-12", className)}
      {...props}
    />
  );
}
