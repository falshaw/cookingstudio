import { describe, expect, it } from "vitest";
import { ZERO, type Macros, type Per100 } from "@/lib/nutrition";
import { SIDES, SIDE_SLUGS, cuisineGroup, pickSides, type SideInput } from "@/lib/sides";

const per = (kcal: number, protein: number, carbs: number, fibre: number): Per100 => ({ kcal, protein, carbs, fat: 1, satFat: 0, fibre, sugar: 0 });
// rough per-100 g values; the real ones come from NutritionRef
const REF: Record<string, Per100> = {
  potato: per(77, 2, 17, 2.2), quinoa: per(368, 14, 64, 7), pumpkin: per(26, 1, 6.5, 0.5), carrot: per(41, 1, 9.6, 2.8),
  "green-beans": per(31, 1.8, 7, 2.7), broccoli: per(34, 2.8, 6.6, 2.6), tomato: per(18, 0.9, 3.9, 1.2), lettuce: per(15, 1.4, 2.9, 1.3),
  "red-pepper": per(31, 1, 6, 2.1), leek: per(61, 1.5, 14, 1.8), "brussels-sprouts": per(43, 3.4, 9, 3.8),
};
const refs = new Map(SIDE_SLUGS.map((s) => [s, { nameEn: s.replace(/-/g, " "), ref: REF[s] ?? per(50, 1, 2, 0) }]));
const portion = (netCarbs: number): Macros => ({ ...ZERO, kcal: 500, protein: 45, netCarbs, carbs: netCarbs });
const base = (over: Partial<SideInput> = {}): SideInput => ({
  recipeSlug: "test-recipe", cuisine: "european", ingredientSlugs: ["chicken-breast"], portion: portion(10),
  profile: { avoidFoods: [], maxNetCarbsPerMeal: 30 }, refs, ...over,
});

describe("healthy sides", () => {
  it("every side line is a known slug list and keys are unique", () => {
    expect(new Set(SIDES.map((s) => s.key)).size).toBe(SIDES.length);
    for (const s of SIDES) expect(s.lines.length).toBeGreaterThan(0);
  });

  it("gives one green, one salad and a third side", () => {
    const p = pickSides(base());
    expect(p.map((s) => s.type).slice(0, 2)).toEqual(["green", "salad"]);
    expect(p.length).toBe(3);
  });

  it("never repeats a vegetable that is already in the dish", () => {
    const p = pickSides(base({ ingredientSlugs: ["chicken-breast", "green-beans", "lettuce", "tomato"] }));
    for (const s of p) {
      const side = SIDES.find((x) => x.key === s.key)!;
      expect(side.main.some((m) => ["green-beans", "lettuce", "tomato"].includes(m)), s.key).toBe(false);
    }
  });

  it("keeps the plate under the carb limit", () => {
    for (const nc of [5, 15, 25, 29]) {
      for (const s of pickSides(base({ portion: portion(nc) }))) expect(s.plate.netCarbs).toBeLessThanOrEqual(30);
    }
  });

  it("offers a small starch only when there is room and the dish has none", () => {
    expect(pickSides(base({ portion: portion(5) })).some((s) => s.type === "starch")).toBe(true);
    expect(pickSides(base({ portion: portion(25) })).some((s) => s.type === "starch")).toBe(false);
    expect(pickSides(base({ portion: portion(5), ingredientSlugs: ["chicken-breast", "potato"] })).some((s) => s.type === "starch")).toBe(false);
  });

  it("drops a side that contains a food on the avoid list", () => {
    const p = pickSides(base({ cuisine: "greek", profile: { avoidFoods: ["feta", "broccoli"], maxNetCarbsPerMeal: 30 } }));
    expect(p.some((s) => s.key === "greek-salad" || s.key.startsWith("broccoli"))).toBe(false);
  });

  it("prefers sides that match the cuisine", () => {
    expect(pickSides(base({ cuisine: "thai" }))[0].key).toMatch(/garlic-ginger-beans|broccoli-soy-lime/);
    expect(pickSides(base({ cuisine: "european" }))[1].key).toMatch(/lettuce-mustard|carrot-lemon-salad|tomato-onion-salad/);
    expect(cuisineGroup("Italian")).toBe("italian");
    expect(cuisineGroup(null)).toBe("any");
  });

  it("is stable for the same recipe and differs between recipes", () => {
    expect(pickSides(base())).toEqual(pickSides(base()));
    const keys = new Set(["a", "b", "c", "d", "e", "f"].map((slug) => pickSides(base({ recipeSlug: slug, cuisine: null })).map((s) => s.key).join()));
    expect(keys.size).toBeGreaterThan(1);
  });

  it("no limit set means no carb filter", () => {
    expect(pickSides(base({ portion: portion(60), profile: { avoidFoods: [], maxNetCarbsPerMeal: null } })).length).toBe(3);
  });
});
