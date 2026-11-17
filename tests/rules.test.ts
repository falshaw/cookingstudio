import { describe, expect, it } from "vitest";
import { checkPortion, checkWeekOmega3, hasFail, isAvoidExcepted, isOmega3Portion, matchesFood, type RuleLine, type RuleProfile } from "@/lib/rules";
import { inferFlags } from "@/lib/flags";
import { ZERO } from "@/lib/nutrition";

const line = (slug: string, nameEn: string, component = "both", grams = 100): RuleLine => ({ slug, nameEn, component, grams, ...inferFlags(nameEn) });
const alex: RuleProfile = { slug: "alex", name: "Alex", vegetarian: false, vegBreakfastAllowed: [], avoidFoods: ["olives", "celery", "kiwi", "coconut", "milk"], noAlcohol: true, noAddedSugar: true, noRefinedStarch: true, maxNetCarbsPerMeal: 60, minProteinPerMeal: 20, maxCookMinutes: 35, omega3MinPerWeek: 1, omega3MaxPerWeek: 2 };
const sam: RuleProfile = { slug: "sam", name: "Sam", vegetarian: true, vegBreakfastAllowed: ["bacon"], avoidFoods: [], noAlcohol: false, noAddedSugar: false, noRefinedStarch: false, maxNetCarbsPerMeal: null, minProteinPerMeal: null, maxCookMinutes: null, omega3MinPerWeek: null, omega3MaxPerWeek: null };
const macros = (netCarbs: number, protein: number) => ({ ...ZERO, netCarbs, protein });
const fails = (i: ReturnType<typeof checkPortion>) => i.filter((x) => x.level === "fail").map((x) => x.code).sort();

describe("diet rules", () => {
  it("passes a compliant plate", () => {
    expect(hasFail(checkPortion(alex, { title: "t", meal: "dinner", totalMinutes: 25, lines: [line("salmon", "Salmon fillet", "alex")], macros: macros(12, 35) }))).toBe(false);
  });
  it("fails >60 g net carbs and <20 g protein", () => {
    expect(fails(checkPortion(alex, { title: "t", meal: "dinner", totalMinutes: 25, lines: [], macros: macros(61, 10) }))).toEqual(["netcarbs", "protein"]);
  });
  it("fails avoid foods, alcohol and added sugar", () => {
    const i = checkPortion(alex, { title: "t", meal: "dinner", totalMinutes: 10, lines: [line("milk", "Milk"), line("red-wine", "Dry red wine"), line("honey", "Honey"), line("olives", "Black olives")], macros: macros(5, 30) });
    expect(fails(i)).toEqual(["alcohol", "avoid", "avoid", "sugar"]);
    expect(matchesFood("buttermilk", "Buttermilk", "milk")).toBe(false);
    expect(matchesFood("coconut-milk", "Coconut milk", "milk")).toBe(true);
    expect(matchesFood("courgette", "Courgette (celery substitute)", "celery")).toBe(false);
  });
  it("ignores the other person's extras", () => {
    const lines = [line("red-wine", "Dry red wine", "sam"), line("ribeye", "Ribeye steak", "alex")];
    expect(hasFail(checkPortion(alex, { title: "t", meal: "dinner", totalMinutes: 10, lines, macros: macros(5, 30) }))).toBe(false);
    expect(hasFail(checkPortion(sam, { title: "t", meal: "dinner", totalMinutes: 10, lines, macros: macros(5, 5) }))).toBe(false);
  });
  it("vegetarian: meat fails at dinner, bacon allowed at breakfast only, chicken stock is meat", () => {
    const p = [line("bacon", "Bacon", "sam")];
    expect(hasFail(checkPortion(sam, { title: "t", meal: "breakfast", totalMinutes: 10, lines: p, macros: ZERO }))).toBe(false);
    expect(hasFail(checkPortion(sam, { title: "t", meal: "dinner", totalMinutes: 10, lines: p, macros: ZERO }))).toBe(true);
    expect(hasFail(checkPortion(sam, { title: "t", meal: "dinner", totalMinutes: 10, lines: [line("chicken-stock", "Chicken stock")], macros: ZERO }))).toBe(true);
    expect(hasFail(checkPortion(sam, { title: "t", meal: "dinner", totalMinutes: 10, lines: [line("vegetable-stock", "Vegetable stock")], macros: ZERO }))).toBe(false);
  });
  it("lunch has its own, stricter limit; leftovers and prep still pass", () => {
    const quick = { ...alex, maxLunchMinutes: 15 };
    expect(fails(checkPortion(quick, { title: "t", meal: "lunch", totalMinutes: 20, lines: [], macros: macros(5, 30) }))).toEqual(["time"]);
    expect(hasFail(checkPortion(quick, { title: "t", meal: "lunch", totalMinutes: 15, lines: [], macros: macros(5, 30) }))).toBe(false);
    expect(hasFail(checkPortion(quick, { title: "t", meal: "lunch", totalMinutes: 40, precooked: true, lines: [], macros: macros(5, 30) }))).toBe(false);
    expect(hasFail(checkPortion(quick, { title: "t", meal: "dinner", totalMinutes: 25, lines: [], macros: macros(5, 30) }))).toBe(false);
  });
  it("time limit applies to fresh meals, not prepped ones", () => {
    expect(hasFail(checkPortion(alex, { title: "t", meal: "dinner", totalMinutes: 45, lines: [], macros: macros(5, 30) }))).toBe(true);
    expect(hasFail(checkPortion(alex, { title: "t", meal: "dinner", totalMinutes: 45, precooked: true, lines: [], macros: macros(5, 30) }))).toBe(false);
  });
  it("white rice is a warning, not a fail", () => {
    const i = checkPortion(alex, { title: "t", meal: "dinner", totalMinutes: 20, lines: [line("basmati-rice", "Basmati rice", "both", 30)], macros: macros(25, 25) });
    expect(i.some((x) => x.code === "starch" && x.level === "warn")).toBe(true);
    expect(hasFail(i)).toBe(false);
  });
  it("counts oily fish per person and enforces 1–2 per week", () => {
    expect(isOmega3Portion([line("salmon", "Salmon fillet", "alex", 150)], "alex")).toBe(true);
    expect(isOmega3Portion([line("salmon", "Salmon fillet", "alex", 150)], "sam")).toBe(false);
    expect(hasFail(checkWeekOmega3(alex, 0))).toBe(true);
    expect(hasFail(checkWeekOmega3(alex, 1))).toBe(false);
    expect(hasFail(checkWeekOmega3(alex, 3))).toBe(true);
  });
  it("infers ingredient flags in code", () => {
    expect(inferFlags("Red wine vinegar").isAlcohol).toBe(false);
    expect(inferFlags("Sugar-free BBQ sauce").isAddedSugar).toBe(false);
    expect(inferFlags("Cauliflower rice").isRefinedStarch).toBe(false);
    expect(inferFlags("Anchovy fillets").isFish).toBe(true);
    expect(inferFlags("Mushroom stock").isMeat).toBe(false);
  });
});

describe("avoid-food exceptions (coconut milk only in curries)", () => {
  const alexEx: RuleProfile = { ...alex, avoidExceptions: [{ allow: "coconut-milk", contexts: ["curry", "thai"], note: "Alex: only in curries" }] };
  const coconutMilk = line("coconut-milk", "Coconut milk (tin)");
  it("allows coconut milk in a curry-tagged or Thai recipe", () => {
    const i = checkPortion(alexEx, { title: "Thai red curry", meal: "dinner", totalMinutes: 20, lines: [coconutMilk], macros: macros(10, 30), context: { title: "Thai red curry", cuisine: "thai", tags: ["curry"] } });
    expect(hasFail(i)).toBe(false);
  });
  it("still refuses coconut milk in a non-curry dish and coconut flakes anywhere", () => {
    expect(hasFail(checkPortion(alexEx, { title: "Smoothie", meal: "breakfast", totalMinutes: 5, lines: [coconutMilk], macros: macros(10, 30), context: { title: "Smoothie", cuisine: "breakfast", tags: [] } }))).toBe(true);
    expect(hasFail(checkPortion(alexEx, { title: "Thai curry", meal: "dinner", totalMinutes: 5, lines: [line("coconut-flakes", "Coconut flakes")], macros: macros(10, 30), context: { title: "Thai curry", cuisine: "thai" } }))).toBe(true);
  });
  it("without context there is no exception", () => {
    expect(isAvoidExcepted(alexEx, coconutMilk)).toBe(false);
    expect(isAvoidExcepted(alexEx, coconutMilk, { sauceFamily: "curry" })).toBe(true);
  });
});
