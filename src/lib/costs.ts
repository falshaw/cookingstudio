// Grocery spending + meal cost. Pure — no Prisma here, unit-tested in tests/costs.test.ts.
//
// Meal cost = for every recipe line, grams × the price per gram last paid for that ingredient.
// A line whose ingredient was never bought with a known weight has no price: the result says how
// many lines are priced, and the total is then a lower bound ("at least"), never a guess.

export type SpendKind = "food" | "drink" | "household";
export const SPEND_KINDS: SpendKind[] = ["food", "drink", "household"];
export const KIND_LABEL: Record<SpendKind, string> = { food: "Food", drink: "Drinks", household: "Household" };

export interface PricedBuy {
  ingredientId: string | null;
  price: number;
  grams: number | null;
  boughtOn: Date;
}

/** Latest price per gram per ingredient (newest receipt wins; same day → the later line in the list). */
export function latestUnitPrices(buys: PricedBuy[]): Map<string, { perGram: number; boughtOn: Date }> {
  const out = new Map<string, { perGram: number; boughtOn: Date }>();
  for (const b of buys) {
    if (!b.ingredientId || !b.grams || b.grams <= 0 || b.price < 0) continue;
    const prev = out.get(b.ingredientId);
    if (prev && prev.boughtOn.getTime() > b.boughtOn.getTime()) continue;
    out.set(b.ingredientId, { perGram: b.price / b.grams, boughtOn: b.boughtOn });
  }
  return out;
}

export interface CostLine {
  ingredientId: string;
  /** "both" = shared base for `servings`; "alex" / "sam" = one portion for that person */
  component: string;
  grams: number;
}

export interface MealCost {
  /** cost of the priced lines only, EUR */
  total: number;
  perPortion: number;
  priced: number;
  lines: number;
  /** every line has a price */
  complete: boolean;
}

/**
 * Cost of a recipe as cooked for `servings` people. Personal lines are one portion each, so they
 * are added once; per portion = total / servings (same split the shopping list uses).
 */
export function mealCost(lines: CostLine[], servings: number, prices: Map<string, { perGram: number }>): MealCost {
  let total = 0;
  let priced = 0;
  for (const l of lines) {
    const p = prices.get(l.ingredientId);
    if (!p) continue;
    total += l.grams * p.perGram;
    priced++;
  }
  const s = Math.max(1, servings);
  return { total: round2(total), perPortion: round2(total / s), priced, lines: lines.length, complete: lines.length > 0 && priced === lines.length };
}

export interface SpendRow {
  boughtOn: Date;
  kind: SpendKind;
  price: number;
}

/** Spend per calendar month (YYYY-MM), newest first, with the split by kind. */
export function spendByMonth(rows: SpendRow[]): { month: string; total: number; byKind: Record<SpendKind, number> }[] {
  const m = new Map<string, Record<SpendKind, number>>();
  for (const r of rows) {
    const key = r.boughtOn.toISOString().slice(0, 7);
    const k = m.get(key) ?? { food: 0, drink: 0, household: 0 };
    k[r.kind] += r.price;
    m.set(key, k);
  }
  return [...m.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([month, byKind]) => ({
      month,
      total: round2(byKind.food + byKind.drink + byKind.household),
      byKind: { food: round2(byKind.food), drink: round2(byKind.drink), household: round2(byKind.household) },
    }));
}

/** Lines of a receipt must add up to its printed total (to the cent). */
export function receiptMismatch(total: number, linePrices: number[]): number {
  return round2(total - linePrices.reduce((s, p) => s + p, 0));
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function eur(n: number): string {
  return `€${n.toFixed(2)}`;
}
