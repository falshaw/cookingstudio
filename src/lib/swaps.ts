// Swap-this-for-that: a static table of practical swaps, offered where a recipe breaks a person's
// rule, and a one-click per-person variant that rewrites just that person's portion.
import type { RecipeContext, RuleLine, RuleProfile } from "./rules";
import { isAvoidExcepted, matchesFood } from "./rules";

export interface Swap {
  from: string; // ingredient slug
  to: string | null; // replacement slug, null = leave it out
  ratio: number; // grams of `to` per gram of `from`
  note: string;
}

/** Only swaps whose target exists in the ingredient guide; `note` explains the idea. */
export const SWAPS: Swap[] = [
  { from: "basmati-rice", to: "cauliflower", ratio: 2.5, note: "Cauliflower rice instead of rice (raw rice ≈ 1/2.5 of its cooked volume)" },
  { from: "arborio-rice", to: "cauliflower", ratio: 2.5, note: "Cauliflower 'risotto' — stir the riced cauliflower into the same sauce" },
  { from: "spaghetti", to: "courgette", ratio: 3, note: "Courgette noodles instead of pasta (lentil/chickpea pasta from the health shelf also works)" },
  { from: "tagliatelle", to: "courgette", ratio: 3, note: "Courgette ribbons (peeler) instead of tagliatelle" },
  // fallbacks for someone who avoids courgette (swapFor skips a target on the person's avoid list)
  { from: "spaghetti", to: "cauliflower", ratio: 2.5, note: "Roast cauliflower or cauliflower rice under the sauce instead of pasta" },
  { from: "tagliatelle", to: "cauliflower", ratio: 2.5, note: "Roast cauliflower or cauliflower rice under the sauce instead of pasta" },
  { from: "quinoa", to: "cauliflower", ratio: 2.5, note: "Cauliflower rice instead of quinoa" },
  { from: "potato", to: "cauliflower", ratio: 1, note: "Roast cauliflower instead of potatoes" },
  { from: "sourdough-bread", to: null, ratio: 0, note: "Skip the bread — or a seeded low-carb loaf from the bakery shelf (not in the guide)" },
  { from: "breadcrumbs", to: "almonds", ratio: 0.8, note: "Ground almonds instead of breadcrumbs" },
  { from: "red-wine", to: "vegetable-stock", ratio: 1, note: "Stock + a splash of red wine vinegar instead of wine (alcohol-free)" },
  { from: "milk", to: "cream", ratio: 0.3, note: "A little cream topped up with water instead of plain milk" },
  { from: "coconut-milk", to: "cream", ratio: 0.5, note: "Coconut-free: half cream, half stock" },
];

export interface SwapSuggestion {
  lineId: string;
  who: string;
  fromName: string;
  reason: string;
  swap: Swap;
}

export interface SwapLine extends RuleLine {
  id: string;
}

/** First swap for this ingredient whose replacement is NOT on the person's own avoid list (null = none fits). */
export function swapFor(p: RuleProfile, slug: string): Swap | null {
  return SWAPS.find((s) => s.from === slug && (!s.to || !p.avoidFoods.some((t) => matchesFood(s.to!, s.to!, t)))) ?? null;
}

/** Which lines break (or are flagged for) this person, and what to swap them for. */
export function suggestSwaps(p: RuleProfile, lines: SwapLine[], ctx?: RecipeContext): SwapSuggestion[] {
  const out: SwapSuggestion[] = [];
  for (const l of lines) {
    if (l.component !== "both" && l.component !== p.slug) continue;
    let reason = "";
    if (p.noAlcohol && l.isAlcohol) reason = "contains alcohol";
    else if (p.noAddedSugar && l.isAddedSugar) reason = "added sugar";
    else if (p.avoidFoods.some((t) => matchesFood(l.slug, l.nameEn, t))) reason = isAvoidExcepted(p, l, ctx) ? "allowed here (exception) — optional swap" : "on the avoid list";
    else if (p.noRefinedStarch && l.isRefinedStarch) reason = "white rice/bread/pasta";
    if (!reason) continue;
    const swap = swapFor(p, l.slug);
    if (swap) out.push({ lineId: l.id, who: p.slug, fromName: l.nameEn, reason, swap });
  }
  return out;
}

export interface VariantPlan {
  /** update the original line (or delete it when null) */
  original: { component: string; grams: number; qty: number } | null;
  /** add a new line for the person (null when the swap removes the food) */
  added: { ingredientSlug: string; component: string; grams: number; qty: number; unit: string } | null;
}

/**
 * Per-person variant: a shared ("both") line becomes the OTHER person's portion line, and the
 * person gets the swap as their own extra. Per-person lines hold ONE portion, base lines hold
 * `servings` portions — quantities are converted accordingly.
 */
export function planVariant(line: { component: string; grams: number; qty: number; unit: string }, swap: Swap, who: "alex" | "sam", servings: number): VariantPlan {
  const other = who === "alex" ? "sam" : "alex";
  const perPortion = line.component === "both" ? 1 / Math.max(1, servings) : 1;
  const grams = line.grams * perPortion;
  const qty = line.qty * perPortion;
  const original = line.component === "both" ? { component: other, grams, qty } : null;
  const added = swap.to ? { ingredientSlug: swap.to, component: who, grams: Math.round(grams * swap.ratio), qty: Math.round(grams * swap.ratio), unit: "g" } : null;
  return { original, added };
}
