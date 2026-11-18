// Red meat at most N× a week: derived from ingredients (no reliable recipe tag),
// checked like the oily-fish limit in the week report, the solver, the freezer fill and swaps.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { checkWeekRedMeat, isRedMeatLine, isRedMeatPortion, redMeatGrams, RED_MEAT_MIN_GRAMS, type RuleLine } from "@/lib/rules";
import { evaluateWeek, fillFromFreezer, redMeatCounts, redMeatFits, solveWeek, type Candidate, type SlotChoice } from "@/lib/planner";
import { toRuleProfile } from "@/lib/recipe-data";
import type { Macros } from "@/lib/nutrition";

const line = (slug: string, o: Partial<RuleLine> = {}): RuleLine => ({ slug, nameEn: slug.replace(/-/g, " "), forUserId: null, grams: 300, isMeat: true, isFish: false, isOmega3: false, isAlcohol: false, isAddedSugar: false, isRefinedStarch: false, ...o });

describe("isRedMeatLine (explicit list, isMeat required)", () => {
  it.each(["beef-mince", "beef-chunks", "beef-burger-patty", "beef-chuck-steak", "ribeye", "sirloin-steak", "pork-shoulder", "pork-shoulder-roast", "lamb-chops", "lamb-shoulder", "pancetta", "guanciale", "smoked-pork-loin", "pork-sausage", "chorizo", "veal-escalope", "goat-leg"])("%s is red meat", (slug) => {
    expect(isRedMeatLine(line(slug))).toBe(true);
  });
  it.each(["chicken-thighs", "chicken-breast", "whole-chicken", "turkey-crown", "chicken-mince", "turkey-mince", "beef-stock", "chicken-stock", "beef-broth", "lard", "gelatine"])("%s is not", (slug) => {
    expect(isRedMeatLine(line(slug))).toBe(false);
  });
  it("needs the isMeat flag — 'beef tomato' is a tomato", () => {
    expect(isRedMeatLine(line("beef-tomato", { isMeat: false }))).toBe(false);
  });
});

describe("red-meat portion", () => {
  it("splits the shared base by servings, adds own lines, ignores the other person's", () => {
    const lines = [line("beef-mince", { grams: 250 }), line("pork-shoulder", { forUserId: "sam", grams: 180 })];
    expect(redMeatGrams(lines, "alex", 2)).toBe(125);
    expect(redMeatGrams(lines, "sam", 2)).toBe(305);
    expect(isRedMeatPortion([line("sirloin-steak", { forUserId: "alex", grams: 170 })], "sam", 2)).toBe(false);
  });
  it(`a small garnish under ${RED_MEAT_MIN_GRAMS} g is not a red-meat meal (40 g bacon at breakfast)`, () => {
    expect(isRedMeatPortion([line("bacon", { forUserId: "sam", grams: 40 })], "sam", 2)).toBe(false);
    expect(isRedMeatPortion([line("bacon", { forUserId: "sam", grams: 60 })], "sam", 2)).toBe(true);
  });
  it("weekly check fails only over the limit, and not at all without one", () => {
    const alex = { ...toRuleProfile({ id: "alex", slug: "alex", name: "Alex", profile: null }), redMeatMaxPerWeek: 2 };
    expect(checkWeekRedMeat(alex, 2)).toEqual([]);
    expect(checkWeekRedMeat(alex, 3)[0]).toMatchObject({ level: "fail", code: "redmeat", msg: "Alex: 3 red-meat meals this week, max 2" });
    expect(checkWeekRedMeat({ ...alex, redMeatMaxPerWeek: null }, 9)).toEqual([]);
  });
  it("the profile value reaches the rule profile", () => {
    const p = toRuleProfile({ id: "alex", slug: "alex", name: "Alex", profile: { vegetarian: false, vegBreakfastAllowed: [], avoidFoods: [], noAlcohol: false, noAddedSugar: false, noRefinedStarch: false, maxNetCarbsPerMeal: null, minProteinPerMeal: null, maxCookMinutes: null, omega3MinPerWeek: null, omega3MaxPerWeek: null, redMeatMaxPerWeek: 2 } });
    expect(p.redMeatMaxPerWeek).toBe(2);
  });
});

const m = { kcal: 500, protein: 35, carbs: 10, netCarbs: 8, fat: 20, satFat: 5, fibre: 4, sugar: 2 } as Macros;
const cand = (slug: string, lines: RuleLine[], kind = "plan", mealTypes = ["lunch", "dinner"]): Candidate => ({
  id: slug, slug, title: slug, kind, mealTypes, totalMinutes: 20, servings: 2, lines,
  macros: { generic: m, byUser: {} }, scores: {}, context: { title: slug, cuisine: "", tags: [], sauceFamily: kind === "lesson" ? "tomato" : null },
});
const beef = cand("mince-pepper-skillet", [line("beef-mince", { grams: 320 })]);
const pork = cand("pulled-pork", [line("pork-shoulder", { grams: 360 })]);
const chicken = cand("chicken-tray", [line("chicken-thighs", { grams: 360 })]);
const eggs = cand("eggs", [line("egg", { isMeat: false, grams: 200 })], "plan", ["breakfast"]);
const bolo = cand("bolognese", [line("beef-mince", { grams: 500 })], "lesson", ["dinner"]);
const all = [beef, pork, chicken, eggs, bolo];
const byslug = new Map(all.map((c) => [c.slug, c]));
const limited = [{ ...toRuleProfile({ id: "alex", slug: "alex", name: "Alex", profile: null }), redMeatMaxPerWeek: 2 }, { ...toRuleProfile({ id: "sam", slug: "sam", name: "Sam", profile: null }), redMeatMaxPerWeek: 2 }];

describe("planner honours the limit", () => {
  it("evaluateWeek counts red-meat meals per person and fails over the limit", () => {
    const week: SlotChoice[] = [0, 1, 2].map((d) => ({ day: d, meal: "dinner" as const, slug: "mince-pepper-skillet" }));
    const rep = evaluateWeek(week, byslug, limited);
    expect(rep.redMeat).toEqual({ alex: 3, sam: 3 });
    expect(rep.ok).toBe(false);
    expect(rep.week.map((i) => i.code)).toEqual(["redmeat", "redmeat"]);
    expect(evaluateWeek(week.slice(0, 2), byslug, limited).ok).toBe(true);
  });
  it("solveWeek never plans more red-meat meals than the limit", () => {
    for (const seed of [1, 7, 42, 99, 1234]) {
      const week = solveWeek(all, limited, [], seed);
      expect(Math.max(...Object.values(redMeatCounts(week, byslug, limited)))).toBeLessThanOrEqual(2);
      expect(week.filter((s) => s.meal !== "breakfast")).toHaveLength(14); // the rest is filled with chicken
    }
  });
  it("without a limit red meat is planned freely", () => {
    const free = limited.map((p) => ({ ...p, redMeatMaxPerWeek: null }));
    const counts = [1, 7, 42].map((seed) => redMeatCounts(solveWeek(all, free, [], seed), byslug, free).alex);
    expect(Math.max(...counts)).toBeGreaterThan(2);
  });
  it("a frozen bolognese does not take a dinner once the week is at the limit", () => {
    const week: SlotChoice[] = Array.from({ length: 7 }, (_, d) => ({ day: d, meal: "dinner" as const, slug: d < 2 ? "mince-pepper-skillet" : "chicken-tray" }));
    const out = fillFromFreezer(week, byslug, limited, [{ id: "b1", slug: "bolognese", left: 6 }]);
    // it may only replace one of the two red-meat dinners (count stays 2), never a chicken day
    expect(out.filter((s) => s.freezerBatchId).map((s) => s.day)).toEqual([0]);
    expect(redMeatCounts(out, byslug, limited)).toEqual({ alex: 2, sam: 2 });
    // replacing a red-meat dinner keeps the count — allowed
    const one: SlotChoice[] = Array.from({ length: 7 }, (_, d) => ({ day: d, meal: "dinner" as const, slug: d === 1 ? "mince-pepper-skillet" : "chicken-tray" }));
    expect(fillFromFreezer(one, byslug, limited, [{ id: "b1", slug: "bolognese", left: 2 }]).filter((s) => s.freezerBatchId)).toHaveLength(1);
  });
  it("redMeatFits: a non-red dish always fits, a red one only under the limit", () => {
    expect(redMeatFits(chicken, limited, { alex: 2, sam: 2 })).toBe(true);
    expect(redMeatFits(beef, limited, { alex: 1, sam: 1 })).toBe(true);
    expect(redMeatFits(beef, limited, { alex: 2, sam: 1 })).toBe(false);
  });
});
