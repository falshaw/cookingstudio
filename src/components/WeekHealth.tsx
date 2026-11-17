import Link from "next/link";
import { REFERENCE, referenceGroup, glDayBand, glMealBand, sourceLabel, type GapFood, type WeekStats } from "@/lib/health-stats";
import { AddToListButton } from "./AddToListButton";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const BAND = { green: "bg-olive/15 border-olive/40", amber: "bg-gold/15 border-gold/50", red: "bg-clay/15 border-clay/40" } as const;

/** Nutrient gaps vs reference intakes + glycemic-load calendar for one person's week. */
export function WeekHealth({ stats, group, tracked, gapFoods = {}, canShop = false }: { stats: WeekStats; group?: string | null; tracked: string[]; gapFoods?: Record<string, GapFood[]>; canShop?: boolean }) {
  if (!stats.hasPlan) return <p className="text-sm text-ink-muted">No meal plan and nothing in the food log this week — <Link href="/plan" className="underline">make a plan</Link> or <Link href="/food-log" className="underline">log what you ate</Link> to see nutrient gaps and glycemic load.</p>;
  const who = referenceGroup(group);
  return (
    <div className="space-y-5">
      <p className="text-sm" data-testid="week-source">This week: <strong>{sourceLabel(stats)}</strong> — days with food-log entries use what you logged, the other days use the meal plan.</p>
      {stats.partialDays > 0 && (
        <p className="text-xs text-ink-muted" data-testid="partial-note">{stats.partialDays} logged day{stats.partialDays === 1 ? "" : "s"} include foods logged without a recipe (USDA grams or a photo). For those the log only stores kcal, protein, net carbs and fat, so fibre, sugar, saturated fat, micronutrients and glycemic load are counted only for recipe foods — and those days are left out of the daily nutrient averages instead of being estimated.</p>
      )}
      <div>
        <h3 className="font-semibold mb-1">Nutrient check (daily average over {stats.detailDays} day{stats.detailDays === 1 ? "" : "s"} with full detail)</h3>
        {tracked.length === 0 ? (
          <p className="text-sm text-ink-muted">No nutrients chosen to watch.</p>
        ) : stats.detailDays === 0 ? (
          <p className="text-sm text-ink-muted">No day this week has full nutrient detail yet — log meals as recipes (or keep to the plan) to see the gap check.</p>
        ) : (
          <table className="text-sm" data-testid="gaps">
            <tbody>
              {tracked.filter((k) => REFERENCE[k]).map((k) => {
                const ref = REFERENCE[k];
                const v = stats.dailyAvg[k] ?? 0;
                const pct = Math.round((v / ref.values[who]) * 100);
                return (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1.5 pr-3">{ref.label}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{v < 10 ? v.toFixed(1) : Math.round(v)} / {ref.values[who]} {ref.unit}</td>
                    <td className="py-1.5 pr-3 w-32"><div className="h-2 rounded-full bg-line overflow-hidden"><div className={pct >= 100 ? "h-full bg-olive" : pct >= 70 ? "h-full bg-gold" : "h-full bg-clay"} style={{ width: `${Math.min(100, pct)}%` }} /></div></td>
                    <td className={`py-1.5 pr-3 text-xs ${pct < 70 ? "text-clay-deep font-semibold" : "text-ink-muted"}`}>{pct}%{pct < 70 && " — gap"}</td>
                    <td className="py-1.5 text-xs text-ink-muted">{ref.source}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {Object.entries(gapFoods).filter(([, f]) => f.length).map(([k, foods]) => (
          <div key={k} className="mt-2 text-sm" data-testid={`gap-foods-${k}`}>
            <p className="font-medium">Foods rich in {REFERENCE[k].label.toLowerCase()} that fit the rules:</p>
            <ul className="flex flex-wrap gap-2 mt-1">
              {foods.map((f) => (
                <li key={f.ingredientId} className="inline-flex items-center gap-1.5 rounded-full bg-sand border border-line pl-2.5 pr-1 py-0.5">
                  <Link href={`/ingredients/${f.slug}`} className="hover:underline">{f.nameEn}</Link>
                  <span className="text-xs text-ink-muted">{f.per100g < 10 ? f.per100g.toFixed(1) : Math.round(f.per100g)} {f.unit}/100 g</span>
                  {canShop && <AddToListButton ingredientId={f.ingredientId} name={f.nameEn} />}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="text-xs text-ink-muted mt-1">From USDA nutrient data × recipe grams: your logged recipe portions on logged days, the planned meals on the others (drinks and foods without a recipe not included). Reference intakes are population values, not personal targets.</p>
      </div>
      {stats.perDay && stats.perDay.epaDha != null && stats.perDay.satFat != null && stats.perDay.unsatFat != null && (
        <div data-testid="fat-quality">
          <h3 className="font-semibold mb-1">Fat quality (daily average)</h3>
          <p className="text-sm">
            Omega-3 from fish (EPA+DHA): <strong>{stats.perDay.epaDha} g/day</strong> · plant omega-3 (ALA): <strong>{stats.perDay.ala} g/day</strong> · unsaturated {stats.perDay.unsatFat} g vs saturated {stats.perDay.satFat} g
            {stats.perDay.satFat > 0 && ` (ratio ${Math.round((stats.perDay.unsatFat / stats.perDay.satFat) * 10) / 10})`} · oily-fish meals {stats.fish}
          </p>
          <p className="text-xs text-ink-muted">EFSA&apos;s adult reference for EPA+DHA is 0.25 g/day (about 1–2 oily-fish meals a week).</p>
        </div>
      )}
      <div>
        <h3 className="font-semibold mb-1">Glycemic load</h3>
        <div className="grid grid-cols-7 gap-1.5" data-testid="gl-calendar">
          {stats.days.map((d) => (
            <div key={d.day} className={`rounded-lg border p-2 text-xs ${d.meals.length ? BAND[glDayBand(d.gl)] : "border-line"}`}>
              <p className="font-semibold">{DAYS[d.day]} <span className="font-normal text-ink-muted">{d.source === "none" ? "" : d.source}{d.partial ? " (part)" : ""}</span></p>
              {d.meals.length ? (
                <>
                  <p className="text-base font-bold tabular-nums">{d.gl}</p>
                  {d.meals.map((m) => <p key={m.meal} title={m.title} className="truncate">{m.meal[0].toUpperCase()}: {m.gl} <span className="text-ink-muted">{glMealBand(m.gl)}</span></p>)}
                  {d.uncountedCarbs > 0 && <p className="text-ink-muted mt-0.5">+{d.uncountedCarbs} g carbs without a GI value</p>}
                </>
              ) : <p className="text-ink-muted">—</p>}
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-muted mt-1">GL = GI × available carbs ÷ 100, using published GI values (International Tables, Sydney GI database) for {`rice, pasta, bread, potato, beans, chickpeas, quinoa, carrots, peas, pumpkin`}. Foods without a published GI are not counted — never estimated. Day: green &lt;80, amber 80–120, red &gt;120. Meal: low ≤10, medium 11–19, high ≥20.</p>
      </div>
    </div>
  );
}
