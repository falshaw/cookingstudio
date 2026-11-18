import Link from "next/link";
import { Clock, Users } from "lucide-react";
import { Pic, Chip } from "./ui";
import { fmtMinutes } from "@/lib/utils";
import { ScoreChip } from "./MealScoreCard";

export interface RecipeCardData {
  slug: string;
  title: string;
  level: number;
  kind: string;
  prepMinutes: number;
  cookMinutes: number;
  servings: number;
  sauceFamily: string | null;
  hero: { id: string; status: string; video?: string | null } | null;
  cookedCount?: number;
  confidence?: number | null;
  /** meal score (the viewer's plate when the recipe has per-person extras, else one portion) */
  score?: { value: number; who: string } | null;
  disliked?: boolean;
}

export function RecipeCard({ r }: { r: RecipeCardData }) {
  const total = r.prepMinutes + r.cookMinutes;
  return (
    <Link href={`/recipes/${r.slug}`} className={`glass-card overflow-hidden flex flex-col ${r.disliked ? "opacity-45 grayscale" : ""}`}>
      <Pic image={r.hero} alt={r.title} className="aspect-[4/3] w-full" rounded="rounded-none" motion="hover" />
      <div className="p-4 flex-1 flex flex-col gap-2">
        <div>
          <h3 className="font-display font-semibold text-ink leading-snug">{r.title}</h3>
        </div>
        <div className="mt-auto flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          <Chip>Level {r.level}</Chip>
          {r.kind === "prep" && <Chip tone="sea">Meal prep</Chip>}
          {r.kind === "plan" && <Chip tone="olive">Weeknight</Chip>}
          {r.sauceFamily && <Chip tone="clay">Sauce</Chip>}
          {total > 30 && r.kind === "lesson" && <Chip tone="gold">Learning · longer</Chip>}
          <span className="inline-flex items-center gap-1"><Clock size={13} />{fmtMinutes(total)}</span>
          <span className="inline-flex items-center gap-1"><Users size={13} />{r.servings}</span>
          {r.disliked && <Chip tone="red">you disliked</Chip>}
          {r.score && <ScoreChip score={r.score.value} label={r.score.who} />}
          {!!r.cookedCount && <Chip tone="olive">cooked {r.cookedCount}×{r.confidence ? ` · ${r.confidence}/5` : ""}</Chip>}
        </div>
      </div>
    </Link>
  );
}
