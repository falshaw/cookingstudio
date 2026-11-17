import Link from "next/link";
import { ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LoopVideo } from "@/components/LoopVideo";
import { HoverClip } from "@/components/HoverClip";

export function PageHeader({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: React.ReactNode }) {
  return (
    <header className="mb-6">
      {eyebrow && <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-clay-text">{eyebrow}</p>}
      <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink mt-1">{title}</h1>
      {children && <div className="mt-2 text-ink-soft max-w-3xl">{children}</div>}
    </header>
  );
}

/** A generated picture. Shows a calm placeholder while ComfyUI still has it in the queue. */
export function Pic({
  image,
  alt,
  className,
  rounded = "rounded-xl",
  motion = "auto",
}: {
  image: { id: string; status: string; video?: string | null } | null | undefined;
  alt: string;
  className?: string;
  rounded?: string;
  /** "hover" = still until the card is hovered/focused (card grids). */
  motion?: "auto" | "hover";
}) {
  if (image?.status === "done" && image.video && motion === "hover") {
    return <HoverClip thumb={`/api/images/${image.id}?w=thumb`} video={`/api/images/${image.id}/video?v=${encodeURIComponent(image.video)}`} alt={alt} className={cn("object-cover bg-sand", rounded, className)} />;
  }
  if (image?.status === "done" && image.video) {
    return <LoopVideo src={`/api/images/${image.id}/video?v=${encodeURIComponent(image.video)}`} poster={`/api/images/${image.id}`} alt={alt} className={cn("object-cover bg-sand", rounded, className)} />;
  }
  if (image?.status === "done" && motion === "hover") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/images/${image.id}?w=thumb`} alt={alt} loading="lazy" decoding="async" className={cn("object-cover bg-sand", rounded, className)} />;
  }
  if (image?.status === "done") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/images/${image.id}`} alt={alt} loading="lazy" className={cn("object-cover bg-sand", rounded, className)} />;
  }
  return (
    <div className={cn("flex flex-col items-center justify-center gap-1 bg-gradient-to-br from-sand to-[#efe6d6] text-ink-muted", rounded, className)} aria-label={`${alt} (picture not generated yet)`}>
      {image?.status === "running" ? <Loader2 className="animate-spin" size={22} /> : <ImageIcon size={22} />}
      <span className="text-[11px]">{image?.status === "running" ? "painting…" : "no picture yet"}</span>
    </div>
  );
}

export function Chip({ children, tone = "neutral", className }: { children: React.ReactNode; tone?: "neutral" | "clay" | "olive" | "sea" | "gold" | "red"; className?: string }) {
  const tones = {
    neutral: "bg-ink/[0.05] text-ink-soft border-line",
    clay: "bg-clay/10 text-clay-deep border-clay/20",
    olive: "bg-olive/10 text-olive border-olive/25",
    sea: "bg-sea/10 text-sea-deep border-sea/25",
    gold: "bg-gold/15 text-[#7a5f0e] border-gold/30",
    red: "bg-clay-deep/10 text-clay-deep border-clay-deep/30",
  } as const;
  return <span className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function Card({ children, className, href }: { children: React.ReactNode; className?: string; href?: string }) {
  const cls = cn("glass-card p-4 block", className);
  return href ? (
    <Link href={href} className={cls}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

export function Stars({ n, max = 5 }: { n: number; max?: number }) {
  return (
    <span aria-label={`${n} of ${max}`} className="text-gold tracking-tight">
      {"★".repeat(Math.round(n))}
      <span className="text-line">{"★".repeat(max - Math.round(n))}</span>
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="glass-card p-6 text-center text-ink-muted">{children}</div>;
}
