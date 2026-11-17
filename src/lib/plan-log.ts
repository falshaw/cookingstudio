// "Ate today's plan": one tap logs the day's planned slots for the signed-in person
// (recipe × their own portion, same macros as POST /api/food-log), and a slot served from a frozen
// sauce batch takes that person's portion off the PrepBatch. Idempotent per slot + day via
// FoodLog.planKey (unique per user): a second tap logs nothing and takes nothing off the freezer.
import { prisma } from "./prisma";
import { compLines, nutritionMap, recipeMacros } from "./recipe-data";
import type { Macros } from "./nutrition";
import { addDays, isoDate } from "./utils";

export const PLAN_MEALS = ["breakfast", "lunch", "dinner"] as const;

/** Stable key of one plan slot on one day — survives a re-solved week (slot ids change, the key does not). */
export const planKey = (weekStart: string, day: number, meal: string) => `${weekStart}:${day}:${meal}`;

/** Day index 0 = Monday of `weekStart` (YYYY-MM-DD) for `day` (YYYY-MM-DD), or null outside that week. */
export function dayIndex(weekStart: string, day: string): number | null {
  const n = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${weekStart}T00:00:00Z`)) / 86_400_000);
  return n >= 0 && n <= 6 ? n : null;
}

export interface PlanSlotLite { id: string; day: number; meal: string; recipeId: string; source: string; prepBatchId: string | null }

/** Which of the day's slots to log now: everything planned that day whose key is not logged yet (meal order). */
export function slotsToLog(slots: PlanSlotLite[], weekStart: string, d: number, logged: Set<string>): { slot: PlanSlotLite; key: string }[] {
  return slots
    .filter((s) => s.day === d)
    .sort((a, b) => PLAN_MEALS.indexOf(a.meal as (typeof PLAN_MEALS)[number]) - PLAN_MEALS.indexOf(b.meal as (typeof PLAN_MEALS)[number]))
    .map((slot) => ({ slot, key: planKey(weekStart, d, slot.meal) }))
    .filter((x) => !logged.has(x.key));
}

/** This person's portion of a recipe (the food log never stores another person's portion). */
export function mine(pm: { generic: Macros; alex: Macros; sam: Macros }, slug: string): Macros {
  return slug === "alex" ? pm.alex : slug === "sam" ? pm.sam : pm.generic;
}

/** kcal + macros of `portions` × my portion of a recipe, from USDA data (same numbers as POST /api/food-log). */
export async function recipeEntryMacros(recipeId: string, portions: number, slug: string) {
  const rec = await prisma.recipe.findUnique({ where: { id: recipeId }, include: { ingredients: { include: { ingredient: true } } } });
  if (!rec) return null;
  const nut = await nutritionMap(rec.ingredients.map((i) => i.ingredient.fdcId));
  const m = mine(recipeMacros(rec.servings, compLines(rec.ingredients, nut)), slug);
  return { title: rec.title, kcal: m.kcal * portions, protein: m.protein * portions, netCarbs: m.netCarbs * portions, fat: m.fat * portions };
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002";

export interface PlanDayStatus { weekStart: string; day: number; slots: { meal: string; title: string; source: string; logged: boolean }[] }

async function findPlanFor(day: string) {
  const plans = await prisma.mealPlan.findMany({ where: { weekStart: { lte: new Date(`${day}T00:00:00Z`), gte: new Date(`${addDays(day, -6)}T00:00:00Z`) } }, include: { slots: { include: { recipe: { select: { title: true } } } } } });
  for (const p of plans) {
    const ws = isoDate(p.weekStart);
    const d = dayIndex(ws, day);
    if (d != null) return { plan: p, ws, d };
  }
  return null;
}

/** What the plan holds for `day` and which slots this person already logged (for the button on /food-log). */
export async function planDayStatus(userId: string, day: string): Promise<PlanDayStatus | null> {
  const hit = await findPlanFor(day);
  if (!hit) return null;
  const slots = hit.plan.slots.filter((s) => s.day === hit.d);
  if (!slots.length) return null;
  const keys = slots.map((s) => planKey(hit.ws, hit.d, s.meal));
  const logged = new Set((await prisma.foodLog.findMany({ where: { userId, planKey: { in: keys } }, select: { planKey: true } })).map((r) => r.planKey));
  return {
    weekStart: hit.ws,
    day: hit.d,
    slots: slots
      .sort((a, b) => PLAN_MEALS.indexOf(a.meal as (typeof PLAN_MEALS)[number]) - PLAN_MEALS.indexOf(b.meal as (typeof PLAN_MEALS)[number]))
      .map((s) => ({ meal: s.meal, title: s.recipe.title, source: s.source, logged: logged.has(planKey(hit.ws, hit.d, s.meal)) })),
  };
}

/**
 * Log `day`'s planned slots for this person. Each slot = one FoodLog row (my portion × 1) with its planKey;
 * a freezer slot also takes 1 portion off its PrepBatch, in the same transaction, only when the row is new.
 */
export async function logPlanDay(user: { id: string; slug: string }, day: string): Promise<{ logged: number; skipped: number; fromFreezer: number } | null> {
  const hit = await findPlanFor(day);
  if (!hit) return null;
  const daySlots = hit.plan.slots.filter((s) => s.day === hit.d);
  if (!daySlots.length) return null;
  const keys = daySlots.map((s) => planKey(hit.ws, hit.d, s.meal));
  const already = new Set((await prisma.foodLog.findMany({ where: { userId: user.id, planKey: { in: keys } }, select: { planKey: true } })).map((r) => r.planKey!));
  const todo = slotsToLog(daySlots, hit.ws, hit.d, already);
  let logged = 0, fromFreezer = 0;
  for (const { slot, key } of todo) {
    const m = await recipeEntryMacros(slot.recipeId, 1, user.slug);
    if (!m) continue;
    const freezer = slot.source === "freezer" && slot.prepBatchId ? slot.prepBatchId : null;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.foodLog.create({
          data: { userId: user.id, date: new Date(`${day}T00:00:00Z`), meal: slot.meal, recipeId: slot.recipeId, label: freezer ? `${m.title} (from the freezer)` : m.title, portions: 1, kcal: m.kcal, protein: m.protein, netCarbs: m.netCarbs, fat: m.fat, planKey: key },
        });
        if (freezer) {
          // never below zero portions left; a batch deleted meanwhile just takes nothing off
          const b = await tx.prepBatch.findUnique({ where: { id: freezer }, select: { portions: true } });
          if (b) {
            const r = await tx.prepBatch.updateMany({ where: { id: freezer, eaten: { lt: b.portions } }, data: { eaten: { increment: 1 } } });
            fromFreezer += r.count;
          }
        }
      });
      logged++;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // a parallel tap logged it first — that counts as skipped
    }
  }
  return { logged, skipped: daySlots.length - logged, fromFreezer };
}
