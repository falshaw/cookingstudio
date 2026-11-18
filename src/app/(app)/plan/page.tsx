import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { PlanClient } from "@/components/PlanClient";
import { isoDate, weekStart } from "@/lib/utils";
import { evaluateWeek, loadCandidates, type Meal } from "@/lib/planner";
import { eatersOf, loadProfiles, macrosFor, toRuleProfile } from "@/lib/recipe-data";
import { currentUser } from "@/lib/auth";
import { nameList, plates } from "@/lib/household";

export default async function PlanPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const { week } = await searchParams;
  const ws = week && /^\d{4}-\d{2}-\d{2}$/.test(week) ? weekStart(new Date(`${week}T00:00:00Z`)) : weekStart(new Date());
  const plan = await prisma.mealPlan.findUnique({
    where: { weekStart: ws },
    include: { slots: { include: { recipe: { select: { id: true, slug: true, title: true, kind: true, goesWith: true } } } }, batches: { include: { recipe: { select: { title: true, slug: true } }, slots: true } } },
  });
  const me = (await currentUser())!;
  const users = await loadProfiles();
  const people = users.map(toRuleProfile);
  const cands = await loadCandidates(eatersOf(users));
  const report = plan
    ? evaluateWeek(plan.slots.map((s) => ({ day: s.day, meal: s.meal as Meal, slug: s.recipe.slug, precooked: s.source !== "fresh", freezerBatchId: s.source === "freezer" ? s.prepBatchId ?? "gone" : undefined, leftover: s.source === "leftover" })), new Map(cands.map((c) => [c.slug, c])), people)
    : null;
  const favs = await prisma.favourite.findMany({ select: { recipeId: true } });
  const recipes = await prisma.recipe.findMany({ where: { status: "published", kind: { in: ["plan", "prep"] } }, orderBy: { title: "asc" }, select: { id: true, title: true, mealTypes: true } });
  const macros = new Map(cands.map((c) => [c.slug, c.macros]));
  return (
    <div>
      <PageHeader eyebrow={`Breakfast · lunch · dinner for ${users.length === 1 ? "one" : nameList(users.map((u) => u.name))}`} title="Meal plan">
        Every week is checked in code against {users.length === 1 ? "your profile" : `all ${users.length} profiles`}: net-carb and protein limits per meal, no added sugar or alcohol where a profile says so, no foods on the avoid lists, weekly oily-fish and red-meat counts. Frozen sauce portions from Meal prep fill dinners first — you only cook the fresh side. Lock what you like, swap one meal, or fill slots with leftovers and prepped portions.
      </PageHeader>
      <PlanClient
        week={isoDate(ws)}
        planId={plan?.id ?? null}
        generatedBy={plan?.generatedBy ?? null}
        favIds={favs.map((f) => f.recipeId)}
        recipes={recipes}
        people={users.map((u) => ({ id: u.id, slug: u.slug, name: u.name }))}
        slots={(plan?.slots ?? []).map((s) => {
          const m = macros.get(s.recipe.slug);
          return {
            id: s.id,
            day: s.day,
            meal: s.meal,
            locked: s.locked,
            source: s.source,
            recipe: s.recipe,
            // the signed-in person's own portion
            mine: m ? { netCarbs: macrosFor(m, me.id).netCarbs, protein: macrosFor(m, me.id).protein, kcal: Math.round(macrosFor(m, me.id).kcal) } : null,
            scores: cands.find((c) => c.slug === s.recipe.slug)?.scores ?? null,
            issues: report?.slots.find((x) => x.day === s.day && x.meal === s.meal)?.issues ?? [],
          };
        })}
        batches={(plan?.batches ?? []).map((b) => ({ id: b.id, title: b.recipe.title, slug: b.recipe.slug, portions: b.portions, used: b.slots.length * plates(users) }))}
        report={report ? { ok: report.ok, week: report.week, omega3: report.omega3, redMeat: report.redMeat } : null}
      />
    </div>
  );
}
