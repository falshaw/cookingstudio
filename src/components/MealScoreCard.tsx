import type { MealScore } from "@/lib/meal-score";
import type { Macros } from "@/lib/nutrition";
import { scoreTone } from "@/lib/meal-score";
import { Chip } from "./ui";

/** Score chip for cards and plan cells. */
export function ScoreChip({ score, label }: { score: number; label?: string }) {
  return <Chip tone={scoreTone(score)}>{label ? `${label} ` : ""}{score}/100</Chip>;
}

/** Per-person meal score with its breakdown and fat quality (recipe page). */
export function MealScoreCard({ people }: { people: { name: string; score: MealScore & { gl: number | null }; macros: Macros }[] }) {
  return (
    <div className="glass-card p-4" data-testid="meal-score">
      <h2 className="font-display text-lg font-semibold mb-1">Meal score & fat quality</h2>
      <p className="text-xs text-ink-muted mb-3">Rule-based in code from the USDA numbers above: protein, fibre, carbs & glycemic load, sugar, fat quality. A guide to everyday balance — not medical advice.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {people.map(({ name, score, macros }) => (
          <div key={name} className="rounded-xl border border-line p-3">
            <p className="flex items-center gap-2 font-semibold">{name} <ScoreChip score={score.score} /></p>
            <ul className="mt-2 space-y-1 text-sm">
              {score.parts.map((p) => (
                <li key={p.key} className="flex items-baseline gap-2">
                  <span className="w-36 shrink-0">{p.label}</span>
                  <span className="tabular-nums font-semibold w-12">{p.points}/{p.max}</span>
                  <span className="text-xs text-ink-muted">{p.note}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-soft">
              Omega-3: <strong>{Math.round((macros.epa + macros.dha) * 100) / 100} g</strong> EPA+DHA · {macros.ala} g ALA · fats: {Math.round((macros.mufa + macros.pufa) * 10) / 10} g unsaturated / {macros.satFat} g saturated
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
