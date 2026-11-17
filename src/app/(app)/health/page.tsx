import Link from "next/link";
import { CalendarClock, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { PageHeader, Chip } from "@/components/ui";
import { LabsClient } from "@/components/LabsClient";
import { serverNow } from "@/lib/utils";
import { WeightClient } from "@/components/WeightClient";
import { WeekHealth } from "@/components/WeekHealth";
import { REFERENCE, foodLabTimeline, referenceGroup, gapFoods, smoothWeights, sourceLabel, weekStats, type GapFood } from "@/lib/health-stats";

// Private tracker: everyone sees ONLY their own labs, weight and food data — no partner view
//. Lab data stays in this database — never sent to an outside service or into any prompt.
export default async function HealthPage() {
  const me = (await currentUser())!;
  const sel = (await prisma.user.findUnique({ where: { id: me.id }, include: { profile: true } }))!;
  const p = sel.profile;
  const [labs, imports] = await Promise.all([
    prisma.labResult.findMany({ where: { userId: me.id }, orderBy: [{ marker: "asc" }, { date: "asc" }] }),
    prisma.labImport.findMany({ where: { userId: me.id, status: { in: ["queued", "running", "review"] } }, select: { id: true, status: true, extracted: true } }),
  ]);
  const weights = await prisma.weightEntry.findMany({ where: { userId: me.id }, orderBy: { date: "asc" } });
  const wrows = smoothWeights(weights.map((w) => ({ date: w.date.toISOString().slice(0, 10), kg: w.kg }))).map((w, i) => ({ ...w, id: weights[i].id }));
  const stats = await weekStats(sel);
  const refKey = referenceGroup(p?.referenceGroup);
  const gaps: Record<string, GapFood[]> = {};
  if (stats.hasPlan && stats.detailDays > 0) {
    for (const k of p?.trackedNutrients ?? []) {
      const ref = REFERENCE[k];
      if (ref && (stats.dailyAvg[k] ?? 0) / ref.values[refKey] < 0.7) gaps[k] = await gapFoods(k, { vegetarian: p?.vegetarian ?? false, avoidFoods: p?.avoidFoods ?? [], noAlcohol: p?.noAlcohol ?? false, noAddedSugar: p?.noAddedSugar ?? false });
    }
  }
  const timeline = await foodLabTimeline(sel);
  const days = p?.nextLabDate ? Math.ceil((p.nextLabDate.getTime() - serverNow()) / 86_400_000) : null;

  // "How your meals are balanced": what I ate on logged days, the plan (my portion) on the others; main meals
  // only (snacks count in the day totals), frozen-sauce plan slots left out (only the sauce is in the plan).
  const a = stats.avgPerMeal;
  const mains = stats.days.flatMap((d) => d.meals).filter((m) => m.meal !== "snack" && !m.freezer);
  const fish = mains.filter((m) => m.fish).length;
  const rules: string[] = [];
  if (p?.vegetarian) rules.push(`vegetarian${p.vegBreakfastAllowed.length ? ` (except ${p.vegBreakfastAllowed.join(", ")} at breakfast)` : ""}`);
  if (p?.maxNetCarbsPerMeal != null) rules.push(`≤${p.maxNetCarbsPerMeal} g net carbs / meal`);
  if (p?.minProteinPerMeal != null) rules.push(`≥${p.minProteinPerMeal} g protein / meal`);
  if (p?.noAddedSugar) rules.push("no added sugar");
  if (p?.noAlcohol) rules.push("no alcohol");
  if (p?.noRefinedStarch) rules.push("white rice/bread/pasta flagged");
  if (p?.omega3MinPerWeek != null) rules.push(`oily fish ${p.omega3MinPerWeek}–${p.omega3MaxPerWeek ?? "?"}× / week`);
  if (p?.redMeatMaxPerWeek != null) rules.push(`red meat ≤ ${p.redMeatMaxPerWeek}× / week`);
  if (p?.maxCookMinutes != null) rules.push(`≤${p.maxCookMinutes} min weeknight cooking`);
  if (p?.maxLunchMinutes != null) rules.push(`≤${p.maxLunchMinutes} min lunch`);
  for (const f of p?.avoidFoods ?? []) rules.push(`never ${f}`);
  const row = (label: string, v: number | null, target: string, okv: boolean | null) => (
    <tr className="border-t border-line">
      <td className="py-1.5 pr-3">{label}</td>
      <td className={`py-1.5 pr-3 tabular-nums font-semibold ${okv === false ? "text-clay-deep" : ""}`}>{v ?? "—"}</td>
      <td className="py-1.5 text-ink-muted">{target}</td>
    </tr>
  );
  const nc = a?.netCarbs ?? null, pr = a?.protein ?? null;

  return (
    <div className="max-w-5xl">
      <PageHeader eyebrow="private · stays on this PC · only you see it" title="Health" />
      <p className="mb-4 inline-flex items-center gap-2 rounded-lg border border-olive/30 bg-olive/10 px-3 py-2 text-sm text-olive">
        <ShieldCheck size={16} /> Lab values never leave this machine — not to any outside service, and never into recipe prompts.
      </p>
      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        <div className="glass-card p-4">
          <p className="text-xs text-ink-muted inline-flex items-center gap-1"><CalendarClock size={14} /> Next blood test</p>
          {p?.nextLabDate ? (
            <>
              <p className="text-2xl font-bold" data-testid="lab-countdown">{days! > 0 ? `in ${days} day${days === 1 ? "" : "s"}` : days === 0 ? "today" : `${-days!} days ago`}</p>
              <p className="text-xs text-ink-muted">{p.nextLabDate.toISOString().slice(0, 10)}</p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">not set — <Link href="/profiles" className="underline">set it</Link></p>
          )}
        </div>
        <div className="glass-card p-4 sm:col-span-2">
          <p className="text-xs text-ink-muted">Goals</p>
          <p className="text-sm whitespace-pre-line">{p?.goals || "No goals written yet."}</p>
          {p?.weightLostKg != null && !/kg down/i.test(p.goals) && <p className="mt-1 text-sm"><strong>{p.weightLostKg} kg</strong> down so far.</p>}
        </div>
      </div>

      <section className="glass-card p-4 mb-6" data-testid="balance">
        <h2 className="font-display text-lg font-semibold mb-2">How your meals are balanced</h2>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {rules.length ? rules.map((r) => <Chip key={r}>{r}</Chip>) : <span className="text-sm text-ink-muted">No food rules set — add them on <Link href="/profiles" className="underline">Profiles</Link>.</span>}
        </div>
        {!a ? (
          <p className="text-sm text-ink-muted">No meal plan and no food log this week — <Link href="/plan" className="underline">make a plan</Link> or <Link href="/food-log" className="underline">log what you ate</Link> to see averages.</p>
        ) : (
          <table className="text-sm" data-testid="balance-table">
            <thead><tr className="text-left text-ink-muted"><th className="pr-3 font-medium">This week, per meal (avg of {a.n} · {sourceLabel(stats)})</th><th className="pr-3 font-medium">{sel.name}</th><th className="font-medium">Target</th></tr></thead>
            <tbody>
              {row("Net carbs (g)", nc, p?.maxNetCarbsPerMeal != null ? `≤ ${p.maxNetCarbsPerMeal}` : "—", nc != null && p?.maxNetCarbsPerMeal != null ? nc <= p.maxNetCarbsPerMeal : null)}
              {row("Protein (g)", pr, p?.minProteinPerMeal != null ? `≥ ${p.minProteinPerMeal}` : "—", pr != null && p?.minProteinPerMeal != null ? pr >= p.minProteinPerMeal : null)}
              {row(`Fibre (g)${a.nDetailed < a.n ? ` · ${a.nDetailed} of ${a.n} meals` : ""}`, a.fibre, "—", null)}
              {row(`Saturated fat (g)${a.nDetailed < a.n ? ` · ${a.nDetailed} of ${a.n} meals` : ""}`, a.satFat, "—", null)}
              {row("Oily-fish meals this week", fish, p?.omega3MinPerWeek != null ? `${p.omega3MinPerWeek}–${p.omega3MaxPerWeek ?? "?"}` : "—", p?.omega3MinPerWeek != null ? fish >= p.omega3MinPerWeek && fish <= (p.omega3MaxPerWeek ?? 99) : null)}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-ink-muted">Macros from USDA FoodData Central × recipe grams: your food log on days you logged, the meal plan on the others. Foods logged without a recipe (USDA grams, photo) carry only kcal, protein, net carbs and fat, so fibre and saturated fat are averaged over the meals that have a recipe. Lab values are not used here.</p>
      </section>

      <WeightClient rows={wrows} />
      <section className="glass-card p-4 mb-6">
        <h2 className="font-display text-lg font-semibold mb-2">This week: nutrients & glycemic load</h2>
        <WeekHealth stats={stats} group={p?.referenceGroup} tracked={p?.trackedNutrients ?? []} gapFoods={gaps} canShop />
        <Link href="/report" className="mt-3 inline-block text-sm underline text-sea-deep">Weekly report</Link>
      </section>
      <section className="glass-card p-4 mb-6" data-testid="timeline">
        <h2 className="font-display text-lg font-semibold">Food ↔ lab timeline</h2>
        <p className="text-sm text-clay-deep font-semibold mb-2">Patterns, not causes — look at these with your doctor.</p>
        {timeline.length === 0 ? (
          <p className="text-sm text-ink-muted">No planned weeks or lab results yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="text-sm min-w-[44rem]">
              <thead>
                <tr className="text-left text-ink-muted text-xs">
                  <th className="pr-3 py-1">Week of</th><th className="pr-3">From</th><th className="pr-3">Net carbs/day</th><th className="pr-3">Sugar/day</th><th className="pr-3">Fibre/day</th><th className="pr-3">Sat fat/day</th><th className="pr-3">Oily fish</th><th className="pr-3">Alcohol</th><th>Labs that week</th>
                </tr>
              </thead>
              <tbody>
                {timeline.map((t) => (
                  <tr key={t.week} className="border-t border-line align-top">
                    <td className="pr-3 py-1.5 whitespace-nowrap">{t.week}</td>
                    <td className="pr-3 text-xs text-ink-muted whitespace-nowrap">{sourceLabel(t)}</td>
                    {t.perDay ? (
                      <>
                        <td className="pr-3 tabular-nums">{t.perDay.netCarbs} g</td>
                        <td className="pr-3 tabular-nums">{t.perDay.sugar != null ? `${t.perDay.sugar} g` : "—"}</td>
                        <td className="pr-3 tabular-nums">{t.perDay.fibre != null ? `${t.perDay.fibre} g` : "—"}</td>
                        <td className="pr-3 tabular-nums">{t.perDay.satFat != null ? `${t.perDay.satFat} g` : "—"}</td>
                        <td className="pr-3 tabular-nums">{t.fish}×</td>
                        <td className="pr-3 tabular-nums">{t.perDay.alcoholG == null ? "—" : t.perDay.alcoholG ? `${t.perDay.alcoholG} g` : "0"}</td>
                      </>
                    ) : (
                      <td colSpan={6} className="pr-3 text-ink-muted text-xs">no meal plan or food log</td>
                    )}
                    <td className="text-xs">{t.labs.map((l) => `${l.marker} ${l.value ?? "—"} ${l.unit}`).join(" · ") || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-ink-muted mt-1">Intake from your food log on the days you logged and from the meal plan on the others (USDA data, your portions); the From column says which. Sugar, fibre, sat fat and alcohol need recipe detail, so a week without such a day shows —. Lab values as entered. <Link href="/glucose" className="underline">Glucose sensor data</Link></p>
      </section>
      <LabsClient
        labs={labs.map((l) => ({ id: l.id, marker: l.marker, value: l.value, unit: l.unit, refLow: l.refLow, refHigh: l.refHigh, date: l.date ? l.date.toISOString().slice(0, 10) : null, flag: l.flag, note: l.note }))}
        imports={imports.map((i) => ({ id: i.id, status: i.status }))}
        pendingReview={(() => { const r = imports.find((i) => i.status === "review"); return r ? { id: r.id, rows: (r.extracted ?? []) as { marker: string; value: number | null; unit: string; refLow: number | null; refHigh: number | null; date: string | null; foundInText?: boolean }[] } : null; })()}
      />
    </div>
  );
}
