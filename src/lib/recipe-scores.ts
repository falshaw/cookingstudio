// Meal scores for many recipes at once (recipe list, favourites). One USDA lookup for all.
import { prisma } from "./prisma";
import { compLines, nutritionMap, recipeMacros } from "./recipe-data";
import { portionGl } from "./health-stats";
import { mealScore } from "./meal-score";

export async function recipeScores(ids: string[]): Promise<Map<string, { value: number; who: string }>> {
  const rs = await prisma.recipe.findMany({ where: { id: { in: ids } }, include: { ingredients: { include: { ingredient: true } } } });
  const nut = await nutritionMap(rs.flatMap((r) => r.ingredients.map((i) => i.ingredient.fdcId)));
  const out = new Map<string, { value: number; who: string }>();
  for (const r of rs) {
    const m = recipeMacros(r.servings, compLines(r.ingredients, nut));
    const split = r.ingredients.some((i) => i.component !== "both");
    const who = split ? "alex" : null;
    const gl = portionGl(r.ingredients.map((i) => ({ component: i.component, grams: i.grams, slug: i.ingredient.slug, ref: i.ingredient.fdcId != null ? nut.get(i.ingredient.fdcId) ?? null : null })), r.servings, who).gl;
    out.set(r.id, { value: mealScore(split ? m.alex : m.generic, gl).score, who: split ? "A" : "" });
  }
  return out;
}
