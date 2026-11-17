// Servings scaler. Base ("both") lines are written for recipe.servings; per-person extras are
// written for ONE portion of that person, and a couple eats servings/2 portions each.

export interface ScaleLine {
  id: string;
  component: string;
  qty: number;
  grams: number;
  unit: string;
}

export function baseFactor(recipeServings: number, target: number): number {
  return target / Math.max(1, recipeServings);
}

/** Portions per person when `target` servings are split between two people. */
export function extraFactor(target: number): number {
  return Math.max(0.5, target / 2);
}

export function scaleLines<T extends ScaleLine>(lines: T[], recipeServings: number, target: number): T[] {
  const bf = baseFactor(recipeServings, target);
  const ef = extraFactor(target);
  return lines.map((l) => {
    const f = l.component === "both" ? bf : ef;
    return { ...l, qty: l.qty * f, grams: l.grams * f };
  });
}

export function clampServings(n: number): number {
  if (!isFinite(n)) return 2;
  return Math.max(1, Math.min(24, Math.round(n)));
}
