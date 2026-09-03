import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  align?: "start" | "center";
  className?: string;
  titleId?: string;
};

export function SectionHeading({
  align = "start",
  className,
  description,
  eyebrow,
  title,
  titleId,
}: SectionHeadingProps) {
  return (
    <div
      className={cn(
        "max-w-3xl",
        align === "center" && "mx-auto text-center",
        className,
      )}
    >
      <p className="mb-5 text-[0.6875rem] font-semibold tracking-[0.18em] text-accent uppercase">
        {eyebrow}
      </p>
      <h2
        className="editorial-balance font-display text-[clamp(2.75rem,7vw,6.75rem)] leading-[0.88] font-medium tracking-[-0.035em]"
        id={titleId}
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-7 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
          {description}
        </p>
      ) : null}
    </div>
  );
}
