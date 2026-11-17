// Meal-plan actions behind /api/plan: instant rule-solver week, swap one meal, lock, leftovers, set.
// Every change re-runs the week's rule check and stores the report.
import { prisma } from "./prisma";
import { evaluateWeek, loadCandidates, loadFreezerBatches, redMeatCounts, redMeatFits, tunaCount, tunaFits, slotIssues, solveWeek, fillFromFreezer, fillLeftoverLunches, writePlan, type Meal, type SlotChoice } from "./planner";
import { hasFail, isOmega3Portion } from "./rules";
import { loadProfiles, toRuleProfile } from "./recipe-data";

export class PlanActionError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const MEAL_ORDER = ["breakfast", "lunch", "dinner"];
export const slotOrder = (s: { day: number; meal: string }) => s.day * 3 + MEAL_ORDER.indexOf(s.meal);

async function context() {
  const users = await loadProfiles();
  const people = users.map(toRuleProfile);
  const pf = { alex: users.find((u) => u.slug === "alex")?.profile?.portionFactor ?? 1, sam: users.find((u) => u.slug === "sam")?.profile?.portionFactor ?? 1 };
  const cands = await loadCandidates(pf);
  const favs = new Set((await prisma.favourite.findMany({ select: { recipeId: true } })).map((f) => f.recipeId));
  return { people, cands, favs };
}

export async function refreshReport(planId: string): Promise<void> {
  const { people, cands } = await context();
  const plan = await prisma.mealPlan.findUnique({ where: { id: planId }, include: { slots: { include: { recipe: true } } } });
  if (!plan) return;
  const choices: SlotChoice[] = plan.slots.map((s) => ({ day: s.day, meal: s.meal as Meal, slug: s.recipe.slug, precooked: s.source !== "fresh", freezerBatchId: s.source === "freezer" ? s.prepBatchId ?? "gone" : undefined, leftover: s.source === "leftover" }));
  const report = evaluateWeek(choices, new Map(cands.map((c) => [c.slug, c])), people);
  await prisma.mealPlan.update({ where: { id: planId }, data: { report: report as object } });
}

/** Instant week from the deterministic rule solver (the AI week runs as a background job). */
export async function solveInstantWeek(ws: Date) {
  const { people, cands, favs } = await context();
  const byslug = new Map(cands.map((c) => [c.slug, c]));
  const choices = fillLeftoverLunches(fillFromFreezer(solveWeek(cands, people, [], (ws.getTime() / 86_400_000) % 9973 || 7, favs), byslug, people, await loadFreezerBatches()), byslug, people);
  const report = evaluateWeek(choices, byslug, people);
  const planId = await writePlan(ws, choices, byslug, "solver", report);
  return { planId, report };
}

async function loadSlot(slotId: string) {
  const slot = await prisma.mealSlot.findUnique({ where: { id: slotId }, include: { recipe: true, plan: { include: { slots: { include: { recipe: true } } } } } });
  if (!slot) throw new PlanActionError("slot not found", 404);
  return slot;
}

export async function lockSlot(slotId: string, locked: boolean) {
  await loadSlot(slotId);
  await prisma.mealSlot.update({ where: { id: slotId }, data: { locked } });
}

export async function applyLeftovers(slotId: string, fromSlotId: string) {
  const slot = await loadSlot(slotId);
  const from = slot.plan.slots.find((s) => s.id === fromSlotId);
  if (!from) throw new PlanActionError("source slot not in this plan");
  if (slotOrder(from) >= slotOrder(slot)) throw new PlanActionError("leftovers must come from an earlier meal");
  await prisma.mealSlot.update({ where: { id: slot.id }, data: { recipeId: from.recipeId, source: "leftover", prepBatchId: null } });
  await refreshReport(slot.planId);
}

export async function setSlot(slotId: string, recipeId: string) {
  const slot = await loadSlot(slotId);
  const rec = await prisma.recipe.findUnique({ where: { id: recipeId } });
  if (!rec) throw new PlanActionError("recipe not found", 404);
  await prisma.mealSlot.update({ where: { id: slot.id }, data: { recipeId: rec.id, source: "fresh", prepBatchId: null } });
  await refreshReport(slot.planId);
}

/** Swap: a different recipe that passes this slot for both people and keeps the week's oily-fish count in range. */
export async function swapSlot(slotId: string): Promise<string> {
  const slot = await loadSlot(slotId);
  const { people, cands, favs } = await context();
  const meal = slot.meal as Meal;
  const fishIn = (slug: string) => {
    const c = cands.find((x) => x.slug === slug);
    return !!c && people.some((p) => isOmega3Portion(c.lines, p.slug));
  };
  const fishOthers = slot.plan.slots.filter((s) => s.id !== slot.id && fishIn(s.recipe.slug)).length;
  const min = Math.max(0, ...people.map((p) => p.omega3MinPerWeek ?? 0));
  const max = Math.min(99, ...people.map((p) => p.omega3MaxPerWeek ?? 99));
  // red-meat meals of the rest of the week (this slot left out) — the swap may not push anyone over
  const redOthers = redMeatCounts(slot.plan.slots.filter((s) => s.id !== slot.id).map((s) => ({ slug: s.recipe.slug })), cands, people);
  const tunaOthers = tunaCount(slot.plan.slots.filter((s) => s.id !== slot.id).map((s) => ({ slug: s.recipe.slug })), cands);
  const options = cands.filter((c) => {
    if (c.slug === slot.recipe.slug || c.kind !== "plan") return false;
    if (hasFail(slotIssues(c, meal, people, false))) return false;
    if (!redMeatFits(c, people, redOthers)) return false;
    if (!tunaFits(c, tunaOthers)) return false;
    const total = fishOthers + (fishIn(c.slug) ? 1 : 0);
    return total >= Math.min(min, fishOthers + 1) && total <= max;
  });
  if (!options.length) throw new PlanActionError("No other recipe passes the rules for this slot.", 409);
  const weighted = options.flatMap((c) => (favs.has(c.id) ? [c, c, c] : [c]));
  const pick = weighted[Math.floor(Math.random() * weighted.length)];
  await prisma.mealSlot.update({ where: { id: slot.id }, data: { recipeId: pick.id, source: "fresh", prepBatchId: null } });
  await refreshReport(slot.planId);
  return pick.title;
}
