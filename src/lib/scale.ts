// Servings scaler. Shared lines (forUserId null) are written for recipe.servings; a person's extra is written
// for ONE portion of that person. `target` servings feed the household target / Σ(portion factors) times, so
// each person's extra is scaled by that × their own portion factor. Extras of someone who is not in `people`
// (no longer in the household) drop out. With two people at portion factor 1 this is the old
// "a couple eats servings/2 portions each".
import { pfOf, portionSum } from "./household";

export interface ScaleLine {
  id: string;
  forUserId: string | null;
  qty: number;
  grams: number;
  unit: string;
}

export interface Eater {
  id: string;
  portionFactor: number;
}

export function baseFactor(recipeServings: number, target: number): number {
  return target / Math.max(1, recipeServings);
}

/** How many household meals `target` servings make (one meal = Σ portion factors). */
export function rounds(target: number, people: Eater[]): number {
  return people.length ? target / portionSum(people) : 0;
}

/** Multiplier for one person's own extra lines: 0 when they are not in the household. */
export function extraFactor(target: number, people: Eater[], personId: string): number {
  const e = people.find((x) => x.id === personId);
  return e ? rounds(target, people) * pfOf(e) : 0;
}

/** Scaled lines for `target` servings; extras of people not in `people` are left out. */
export function scaleLines<T extends ScaleLine>(lines: T[], recipeServings: number, target: number, people: Eater[]): T[] {
  const bf = baseFactor(recipeServings, target);
  const out: T[] = [];
  for (const l of lines) {
    const f = l.forUserId == null ? bf : extraFactor(target, people, l.forUserId);
    if (l.forUserId != null && f === 0) continue;
    out.push({ ...l, qty: l.qty * f, grams: l.grams * f });
  }
  return out;
}

/** Servings for one household meal (× `meals`), as a whole number. */
export function servingsFor(people: Eater[], meals = 1): number {
  return clampServings(portionSum(people) * meals);
}

/** Opening servings for a recipe page: the recipe as written, or one meal for the household if that is more. */
export function defaultServings(recipeServings: number, people: Eater[]): number {
  return Math.max(clampServings(recipeServings), people.length ? servingsFor(people) : 0);
}

export function clampServings(n: number): number {
  if (!isFinite(n)) return 2;
  return Math.max(1, Math.min(24, Math.round(n)));
}
