// Meal scores for many recipes at once (recipe list, favourites). One USDA lookup for all.
import { prisma } from "./prisma";
import { compLines, eatersOf, macrosFor, nutritionMap, recipeMacros } from "./recipe-data";
import { HOUSEHOLD_ORDER, pfOf } from "./household";
import { portionGl } from "./health-stats";
import { mealScore } from "./meal-score";

/** Score of one portion: the viewer's plate when the recipe has per-person extras, else the shared portion. */
export async function recipeScores(ids: string[], viewerId?: string): Promise<Map<string, { value: number; who: string }>> {
  const rs = await prisma.recipe.findMany({ where: { id: { in: ids } }, include: { ingredients: { include: { ingredient: true } } } });
  const users = await prisma.user.findMany({ orderBy: HOUSEHOLD_ORDER, select: { id: true, name: true, profile: { select: { portionFactor: true } } } });
  const viewer = users.find((u) => u.id === viewerId) ?? users[0];
  const people = viewer ? eatersOf([viewer]) : [];
  const nut = await nutritionMap(rs.flatMap((r) => r.ingredients.map((i) => i.ingredient.fdcId)));
  const out = new Map<string, { value: number; who: string }>();
  for (const r of rs) {
    const split = !!viewer && r.ingredients.some((i) => i.forUserId != null);
    const who = split ? viewer.id : null;
    const m = recipeMacros(r.servings, compLines(r.ingredients, nut), people);
    const gl = portionGl(r.ingredients.map((i) => ({ forUserId: i.forUserId, grams: i.grams, slug: i.ingredient.slug, ref: i.ingredient.fdcId != null ? nut.get(i.ingredient.fdcId) ?? null : null })), r.servings, who, split ? pfOf(people[0]) : 1).gl;
    out.set(r.id, { value: mealScore(split ? macrosFor(m, who) : m.generic, gl).score, who: split ? viewer.name.slice(0, 1).toUpperCase() : "" });
  }
  return out;
}
