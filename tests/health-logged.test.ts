// Health numbers from what was eaten: food log on logged days, plan on the others, labelled,
// and nothing invented for foods logged without a recipe (only kcal / protein / net carbs / fat stored).
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { computeWeek, sourceLabel } from "@/lib/health-stats";

const ing = (slug: string, fdcId: number, o: Record<string, unknown> = {}) => ({ slug, nameEn: slug, fdcId, isMeat: false, isFish: false, isOmega3: false, isAlcohol: false, isAddedSugar: false, isRefinedStarch: false, ...o });
// per 100 g
const refs = new Map([
  [1, { kcal: 350, protein: 8, carbs: 78, fat: 1, satFat: 0.2, fibre: 1.3, sugar: 0, b12: 0, iron: 1, zinc: 1, ala: 0, magnesium: 25, vitD: 0 }], // rice
  [2, { kcal: 200, protein: 20, carbs: 0, fat: 13, satFat: 3, fibre: 0, sugar: 0, b12: 4, iron: 0.5, zinc: 0.5, ala: 0.1, magnesium: 30, vitD: 11, epa: 0.7, dha: 1.4 }], // salmon
  [3, { kcal: 20, protein: 1, carbs: 4, fat: 0.2, satFat: 0, fibre: 2, sugar: 2, b12: 0, iron: 0.4, zinc: 0.2, ala: 0, magnesium: 15, vitD: 0 }], // courgette
]);
const recipes = [
  { id: "rice-bowl", title: "Rice bowl", servings: 2, ingredients: [{ forUserId: null, grams: 200, ingredient: ing("basmati-rice", 1) }, { forUserId: null, grams: 400, ingredient: ing("courgette", 3) }] },
  { id: "salmon", title: "Salmon", servings: 2, ingredients: [{ forUserId: null, grams: 300, ingredient: ing("salmon", 2, { isFish: true, isOmega3: true }) }, { forUserId: null, grams: 400, ingredient: ing("courgette", 3) }] },
];
const WS = "2026-11-09";
const slots = [0, 1, 2].flatMap((day) => [{ day, meal: "lunch", recipeId: "rice-bowl" }, { day, meal: "dinner", recipeId: "rice-bowl" }]);
const log = (day: string, meal: string, o: Partial<{ label: string; recipeId: string | null; portions: number; netCarbs: number; protein: number }> = {}) => ({ date: new Date(`${day}T00:00:00Z`), meal, label: "x", recipeId: null, portions: 1, netCarbs: 0, protein: 0, ...o });

describe("computeWeek: logged days use the food log, other days the plan", () => {
  it("plan only → every counted day is 'planned' with full detail", () => {
    const w = computeWeek({ who: "alex", pf: 1, weekStart: WS, slots, logs: [], recipes, refs });
    expect(w.days.slice(0, 4).map((d) => d.source)).toEqual(["planned", "planned", "planned", "none"]);
    expect([w.planned, w.logged, w.detailDays, w.partialDays]).toEqual([3, 0, 3, 0]);
    expect(sourceLabel(w)).toBe("planned (3 days)");
    expect(w.avgPerMeal?.n).toBe(6);
  });

  it("a logged day replaces that day's plan — the plan is not counted on top", () => {
    const logs = [log("2026-11-10", "dinner", { label: "Salmon", recipeId: "salmon", netCarbs: 6, protein: 30 })];
    const w = computeWeek({ who: "alex", pf: 1, weekStart: WS, slots, logs, recipes, refs });
    const tue = w.days[1];
    expect(tue.source).toBe("logged");
    expect(tue.meals.map((m) => m.title)).toEqual(["Salmon"]); // not the planned rice bowls
    expect(tue.netCarbs).toBe(6); // the stored macros of the entry
    expect(tue.nutrients.vitD).toBeCloseTo(16.5, 5); // 150 g salmon × 11 µg/100 g, from the recipe
    expect(tue.epaDha).toBeCloseTo(3.15, 5);
    expect(w.fish).toBe(1);
    expect(sourceLabel(w)).toBe("1 day logged · 2 planned");
  });

  it("portions scale the recipe detail of a logged entry", () => {
    const one = computeWeek({ who: "alex", pf: 1, weekStart: WS, slots: [], logs: [log("2026-11-10", "dinner", { recipeId: "salmon" })], recipes, refs });
    const two = computeWeek({ who: "alex", pf: 1, weekStart: WS, slots: [], logs: [log("2026-11-10", "dinner", { recipeId: "salmon", portions: 2 })], recipes, refs });
    expect(two.days[1].fibre).toBeCloseTo(one.days[1].fibre * 2, 5);
  });

  it("a food without a recipe adds only its stored macros: no fibre, no micros, carbs not GI-counted, day marked partial", () => {
    const logs = [log("2026-11-10", "breakfast", { label: "Feta 50 g", netCarbs: 2, protein: 7 }), log("2026-11-10", "dinner", { recipeId: "rice-bowl", netCarbs: 60, protein: 10 })];
    const w = computeWeek({ who: "alex", pf: 1, weekStart: WS, slots: [], logs, recipes, refs });
    const tue = w.days[1];
    expect(tue.partial).toBe(true);
    const breakfast = tue.meals.find((m) => m.meal === "breakfast")!;
    expect(breakfast).toMatchObject({ detailed: false, fibre: null, satFat: null, netCarbs: 2, protein: 7, gl: 0, uncountedCarbs: 2 });
    expect(tue.netCarbs).toBe(62);
    // the partial day is left out of the daily nutrient averages (never estimated) …
    expect(w.detailDays).toBe(0);
    expect(w.dailyAvg.fibre).toBe(0);
    expect(w.perDay).toMatchObject({ netCarbs: 62, fibre: null, sugar: null, satFat: null, epaDha: null });
    // … and per-meal fibre/sat fat/GL use only the meal with a recipe
    expect(w.avgPerMeal).toMatchObject({ n: 2, nDetailed: 1, netCarbs: 31, protein: 8.5 });
    expect(w.avgPerMeal!.fibre).toBeCloseTo(1.3 + 4, 1); // 100 g rice + 200 g courgette
  });

  it("snacks count in the day, not as a meal; frozen-sauce plan slots are not averaged as meals", () => {
    const logs = [log("2026-11-10", "snack", { recipeId: "rice-bowl", netCarbs: 60, protein: 10 }), log("2026-11-10", "lunch", { recipeId: "salmon", netCarbs: 6, protein: 30 })];
    const w = computeWeek({ who: "alex", pf: 1, weekStart: WS, slots: [{ day: 0, meal: "dinner", recipeId: "rice-bowl", source: "freezer" }], logs, recipes, refs });
    expect(w.days[1].netCarbs).toBe(66);
    expect(w.avgPerMeal).toMatchObject({ n: 1, netCarbs: 6 });
    expect(w.days[0].meals[0].freezer).toBe(true);
  });

  it("nothing anywhere → no data", () => {
    const w = computeWeek({ who: "alex", pf: 1, weekStart: WS, slots: [], logs: [], recipes, refs });
    expect([w.hasPlan, w.avgPerMeal, w.perDay]).toEqual([false, null, null]);
    expect(sourceLabel(w)).toBe("no data");
    expect(sourceLabel({ logged: 7, planned: 0 })).toBe("logged (7 days)");
  });
});
