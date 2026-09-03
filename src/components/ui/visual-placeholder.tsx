import { cn } from "@/lib/utils";

type VisualPlaceholderProps = {
  label: string;
  tone?: "ink" | "stone" | "umber";
  className?: string;
};

export function VisualPlaceholder({
  className,
  label,
  tone = "ink",
}: VisualPlaceholderProps) {
  return (
    <div
      aria-label={label}
      className={cn("visual-placeholder", className)}
      data-tone={tone}
      role="img"
    >
      <span className="absolute bottom-5 left-5 z-10 text-[0.625rem] tracking-[0.16em] text-foreground/65 uppercase sm:bottom-7 sm:left-7">
        Visual study
      </span>
    </div>
  );
}
