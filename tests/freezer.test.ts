import { describe, expect, it } from "vitest";
import { fillFromFreezer, plannable, solveWeek, type Candidate, type SlotChoice } from "@/lib/planner";
import type { RuleLine } from "@/lib/rules";
import type { Macros } from "@/lib/nutrition";
import { toRuleProfile } from "@/lib/recipe-data";

const m = { kcal: 500, protein: 30, carbs: 10, netCarbs: 8, fat: 20, satFat: 5, fibre: 4, sugar: 2 } as Macros;
const line = (over: Partial<RuleLine> = {}): RuleLine => ({ slug: "x", nameEn: "x", forUserId: null, grams: 100, isMeat: false, isFish: false, isOmega3: false, isAlcohol: false, isAddedSugar: false, isRefinedStarch: false, ...over }) as RuleLine;
const cand = (slug: string, kind: string, lines: RuleLine[] = [line()], sauceFamily: string | null = kind === "lesson" ? "tomato" : null): Candidate => ({
  id: slug, slug, title: slug, kind, mealTypes: ["dinner"], totalMinutes: 20, servings: 2, lines,
  macros: { generic: m, byUser: {} }, scores: {}, context: { title: slug, cuisine: "", tags: [], sauceFamily },
});

const cands = [cand("pasta", "plan"), cand("salmon", "plan", [line({ isFish: true, isOmega3: true, grams: 150 })]), cand("bolognese", "lesson")];
const byslug = new Map(cands.map((c) => [c.slug, c]));
const people = [toRuleProfile({ id: "alex", slug: "alex", name: "Alex", profile: null }), toRuleProfile({ id: "sam", slug: "sam", name: "Sam", profile: null })];

describe("freezer sauces in the plan", () => {
  it("fills dinners from frozen portions, skipping locked, fish and back-to-back days", () => {
    const week: SlotChoice[] = Array.from({ length: 7 }, (_, d) => ({ day: d, meal: "dinner" as const, slug: d === 1 ? "salmon" : "pasta", locked: d === 0 }));
    const out = fillFromFreezer(week, byslug, people, [{ id: "b1", slug: "bolognese", left: 5 }]);
    const frozen = out.filter((s) => s.freezerBatchId === "b1").map((s) => s.day);
    expect(frozen).toEqual([2, 4]); // Mon locked, Tue fish, Wed + Fri (not Thu — no repeat next day); 5 portions = 2 dinners
    expect(out.find((s) => s.day === 2)).toMatchObject({ slug: "bolognese", precooked: true });
    expect(week.every((s) => !s.freezerBatchId)).toBe(true); // input untouched
  });

  it("takes one portion per household member: 5 portions are one dinner for three", () => {
    const three = [...people, toRuleProfile({ id: "robin", slug: "robin", name: "Robin", profile: null })];
    const week: SlotChoice[] = Array.from({ length: 7 }, (_, d) => ({ day: d, meal: "dinner" as const, slug: "pasta" }));
    const out = fillFromFreezer(week, byslug, three, [{ id: "b1", slug: "bolognese", left: 5 }]);
    expect(out.filter((s) => s.freezerBatchId === "b1").map((s) => s.day)).toEqual([0]);
  });

  it("a 6-portion prep batch covers 3 dinners for two, 2 dinners for three", () => {
    const chili = { ...cand("chili", "prep"), servings: 6 };
    const three = [...people, toRuleProfile({ id: "robin", slug: "robin", name: "Robin", profile: null })];
    const precooked = (ps: typeof people) => solveWeek([chili], ps, []).filter((s) => s.precooked).map((s) => s.day);
    expect(precooked(people)).toEqual([1, 2, 4, 5]);
    expect(precooked(three)).toEqual([1, 3, 5]);
  });

  it("never offers sauces as fresh plan meals", () => {
    expect(plannable(cands).map((c) => c.slug)).toEqual(["pasta", "salmon"]);
  });
});
