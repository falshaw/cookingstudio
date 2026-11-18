// Sauce features: fridge matching, freezer-sauce filter, sauce credit in practice, ladder suggestion,
// drill start, and POST /api/cook storing the credit from the recipe row (never from the client).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";
import { buildPracticeMap, makeAgain, type PracticeLog } from "@/lib/practice";
import { drillServings, drillStartIndex, FREEZER_SAUCE_WHERE, isFreezerSauce, ladderRow, matchSauces, nextInFamily, RESCUE_TIPS } from "@/lib/sauce-ladder";
import { fillFromFreezer, type Candidate } from "@/lib/planner";
import { toRuleProfile } from "@/lib/recipe-data";
import type { Macros } from "@/lib/nutrition";
import type { RuleLine } from "@/lib/rules";

const h = vi.hoisted(() => ({ overrides: {} as Overrides }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return makePrisma(h.overrides).client;
  },
}));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => ({ id: "calex00000000000000000000001", slug: "alex", name: "Alex", email: "n@k" })) }));

beforeEach(() => {
  h.overrides = {};
});

const ln = (slug: string, over: { isMeat?: boolean; isFish?: boolean } = {}) => ({ slug, nameEn: slug.replace(/-/g, " "), isMeat: false, isFish: false, ...over });
const sauce = (slug: string, lines: ReturnType<typeof ln>[], level = 1, family = "quick") => ({ id: slug, slug, title: slug, level, sauceFamily: family, lines });

describe("sauce from my fridge", () => {
  const sauces = [
    sauce("s1-mustard-cream", [ln("dijon-mustard"), ln("cream"), ln("water"), ln("salt"), ln("black-pepper"), ln("olive-oil"), ln("chicken-breast", { isMeat: true })]),
    sauce("s1-lemon-butter", [ln("lemon"), ln("butter"), ln("garlic"), ln("water"), ln("chicken-breast", { isMeat: true })]),
    sauce("s1-garlic-yogurt", [ln("greek-yogurt"), ln("garlic"), ln("lemon")]),
    sauce("only-pantry", [ln("water"), ln("salt")]),
  ];
  it("lists sauces makeable now and the ones one ingredient short; water/salt/pepper/oil and the meat never block", () => {
    const { ready, oneShort } = matchSauces(sauces, new Set(["dijon-mustard", "cream", "garlic", "butter"]));
    expect(ready.map((m) => m.sauce.slug)).toEqual(["s1-mustard-cream"]);
    expect(ready[0].withProtein).toEqual(["chicken breast"]);
    expect(oneShort.map((m) => [m.sauce.slug, m.missing])).toEqual([["s1-lemon-butter", ["lemon"]]]);
    // garlic-yogurt misses 2 → not listed; a sauce of only pantry basics is not a match
    expect([...ready, ...oneShort].some((m) => m.sauce.slug === "s1-garlic-yogurt" || m.sauce.slug === "only-pantry")).toBe(false);
  });
});

describe("freezer sauces", () => {
  it("only real sauces: lesson + sauce family + freezer days", () => {
    expect(isFreezerSauce({ kind: "lesson", sauceFamily: "tomato", freezerDays: 90 })).toBe(true);
    expect(isFreezerSauce({ kind: "lesson", sauceFamily: null, freezerDays: 30 })).toBe(false); // perfect-rice, roasts, stocks
    expect(isFreezerSauce({ kind: "lesson", sauceFamily: "quick", freezerDays: 0 })).toBe(false);
    expect(isFreezerSauce({ kind: "plan", sauceFamily: "tomato", freezerDays: 90 })).toBe(false);
    expect(FREEZER_SAUCE_WHERE).toEqual({ kind: "lesson", sauceFamily: { not: null }, freezerDays: { gt: 0 } });
  });
  it("the plan never fills a dinner from a frozen non-sauce lesson", () => {
    const m = { kcal: 500, protein: 30, carbs: 10, netCarbs: 8, fat: 20, satFat: 5, fibre: 4, sugar: 2 } as Macros;
    const line = { slug: "x", nameEn: "x", forUserId: null, grams: 100, isMeat: false, isFish: false, isOmega3: false, isAlcohol: false, isAddedSugar: false, isRefinedStarch: false } as RuleLine;
    const c = (slug: string, kind: string, fam: string | null): Candidate => ({ id: slug, slug, title: slug, kind, mealTypes: ["dinner"], totalMinutes: 20, servings: 2, lines: [line], macros: { generic: m, byUser: {} }, scores: {}, context: { title: slug, cuisine: "", tags: [], sauceFamily: fam } });
    const cands = new Map([c("pasta", "plan", null), c("perfect-rice", "lesson", null), c("tomato-sauce", "lesson", "tomato")].map((x) => [x.slug, x]));
    const week = Array.from({ length: 7 }, (_, d) => ({ day: d, meal: "dinner" as const, slug: "pasta" }));
    const people = [toRuleProfile({ id: "alex", slug: "alex", name: "Alex", profile: null }), toRuleProfile({ id: "sam", slug: "sam", name: "Sam", profile: null })];
    expect(fillFromFreezer(week, cands, people, [{ id: "b1", slug: "perfect-rice", left: 4 }]).some((s) => s.freezerBatchId)).toBe(false);
    expect(fillFromFreezer(week, cands, people, [{ id: "b2", slug: "tomato-sauce", left: 4 }]).filter((s) => s.freezerBatchId).length).toBe(2);
  });
});

describe("practice counts sauce credits", () => {
  const log = (recipeId: string, over: Partial<PracticeLog> = {}): PracticeLog => ({ recipeId, confidence: 3, rating: 4, cookedAt: new Date("2026-11-10T18:00:00Z"), tweak: "", sauceLessonSlug: null, sauceRating: null, ...over });
  const ids = new Map([["s1-mustard-cream", "lesson1"]]);
  it("a dish with a sauce lesson credits the lesson with the sauce rating, not the dish rating", () => {
    const pm = buildPracticeMap([log("dish", { rating: 5, sauceLessonSlug: "s1-mustard-cream", sauceRating: 3 }), log("dish2", { sauceLessonSlug: "s1-mustard-cream", sauceRating: 5 })], ids);
    expect(pm.get("lesson1")).toMatchObject({ count: 2, lastRating: 5, bestRating: 5, confidence: null });
    expect(pm.get("dish")).toMatchObject({ count: 1, lastRating: 5, confidence: 3 });
    // a lesson known only from credits is not "make it again" (no confidence of its own)
    expect(makeAgain([{ id: "lesson1" }, { id: "dish" }], pm).map((r) => r.id)).toEqual(["dish"]);
  });
  it("never double-counts when the logged recipe is the lesson; unknown slugs are ignored", () => {
    const pm = buildPracticeMap([log("lesson1", { sauceLessonSlug: "s1-mustard-cream", sauceRating: 2 }), log("dish", { sauceLessonSlug: "gone" })], ids);
    expect(pm.get("lesson1")!.count).toBe(1);
    expect(pm.size).toBe(2);
  });
  it("an unrated credit counts as made but leaves the ratings alone", () => {
    const pm = buildPracticeMap([log("dish", { sauceLessonSlug: "s1-mustard-cream" })], ids);
    expect(pm.get("lesson1")).toMatchObject({ count: 1, lastRating: null, bestRating: null });
  });
});

describe("sauce ladder", () => {
  const sauces = [
    { id: "a", title: "Pan juice", level: 1, sauceFamily: "quick" },
    { id: "b", title: "Mustard", level: 1, sauceFamily: "quick" },
    { id: "c", title: "Gravy", level: 4, sauceFamily: "pan" },
    { id: "d", title: "Jus", level: 4, sauceFamily: "pan" },
  ];
  const p = (count: number, lastRating: number | null) => ({ count, confidence: 4, last: new Date(), tweak: "", lastRating, bestRating: lastRating });
  it("suggests the next sauce in the family once one is made ≥2× with rating ≥4", () => {
    expect(nextInFamily(sauces, new Map([["a", p(1, 5)]])).size).toBe(0); // only once
    expect(nextInFamily(sauces, new Map([["a", p(2, 3)]])).size).toBe(0); // rated 3
    const next = nextInFamily(sauces, new Map([["a", p(2, 4)], ["c", p(3, 5)], ["d", p(1, 2)]]));
    expect(next.get("quick")?.id).toBe("b");
    expect(next.has("pan")).toBe(false); // nothing left to learn in "pan"
    expect(ladderRow(sauces[0], new Map([["a", p(2, 4)]]))).toMatchObject({ made: 2, lastRating: 4, mastered: true });
    expect(ladderRow(sauces[1], new Map())).toMatchObject({ made: 0, lastRating: null, mastered: false });
  });
  it("has one rescue tip for each Level-1 quick sauce", () => {
    for (const s of ["s1-roast-tomato-feta", "s1-pan-juice-cream", "s1-mustard-cream", "s1-lemon-butter", "s1-garlic-yogurt", "s1-tomato-paste"]) expect(RESCUE_TIPS[s]?.fix).toBeTruthy();
  });
});

describe("sauce drill", () => {
  it("skips the leading meat-only steps and keeps a 1–2 portion batch", () => {
    const protein = new Set(["chick"]);
    expect(drillStartIndex([{ text: "Salt the chicken and fry it until cooked through.", lineIds: ["chick"] }, { text: "Scrape the pan, bubble 2 minutes.", lineIds: ["water"] }], protein)).toBe(1);
    expect(drillStartIndex([{ text: "Salt the chicken and fry it in the oil until cooked through. Plate it.", lineIds: [] }, { text: "Sauce", lineIds: [] }], protein)).toBe(1);
    expect(drillStartIndex([{ text: "Roast chicken and tomatoes 20 min", lineIds: ["chick", "tom"] }, { text: "Press", lineIds: [] }], protein)).toBe(0);
    expect(drillStartIndex([{ text: "Fry the chicken until cooked through", lineIds: ["chick"] }], protein)).toBe(0); // never past the last step
    expect([drillServings(1), drillServings(2), drillServings(NaN), drillServings(6)]).toEqual([1, 2, 2, 2]);
  });
});

describe("POST /api/cook sauce credit", () => {
  const RECIPE = "crec00000000000000000000001";
  it("stores the dish's own published lesson + the sauce rating", async () => {
    let data: Record<string, unknown> = {};
    h.overrides = {
      recipe: {
        findUnique: async () => ({ id: RECIPE, slug: "chicken-mustard", sauceLesson: "s1-mustard-cream" }),
        findFirst: async (a: { where: { slug: string; status: string; kind: string } }) => (a.where.status === "published" && a.where.kind === "lesson" ? { slug: a.where.slug } : null),
      },
      cookLog: { create: async (a: { data: Record<string, unknown> }) => ((data = a.data), { id: "clog1", ...a.data }) },
    };
    const { POST } = await import("@/app/api/cook/route");
    const res = await POST(new Request("http://127.0.0.1:3030/api/cook", { method: "POST", body: JSON.stringify({ recipeId: RECIPE, rating: 5, confidence: 3, sauceRating: 4 }) }));
    expect(await res.json()).toMatchObject({ ok: true, sauceCredit: "s1-mustard-cream" });
    expect(data).toMatchObject({ sauceLessonSlug: "s1-mustard-cream", sauceRating: 4, rating: 5 });
  });
  it("no credit when the cook unticks it, the recipe has no lesson, or the rating is out of range", async () => {
    let data: Record<string, unknown> = {};
    h.overrides = {
      recipe: { findUnique: async () => ({ id: RECIPE, slug: "plain", sauceLesson: "s1-mustard-cream" }), findFirst: async () => ({ slug: "s1-mustard-cream" }) },
      cookLog: { create: async (a: { data: Record<string, unknown> }) => ((data = a.data), { id: "clog2", ...a.data }) },
    };
    const { POST } = await import("@/app/api/cook/route");
    await POST(new Request("http://127.0.0.1:3030/api/cook", { method: "POST", body: JSON.stringify({ recipeId: RECIPE, rating: 4, confidence: 4, sauceCredit: false, sauceRating: 5 }) }));
    expect(data).toMatchObject({ sauceLessonSlug: null, sauceRating: null });
    const bad = await POST(new Request("http://127.0.0.1:3030/api/cook", { method: "POST", body: JSON.stringify({ recipeId: RECIPE, rating: 4, confidence: 4, sauceRating: 9 }) }));
    expect(bad.status).toBe(400);
    h.overrides.recipe = { findUnique: async () => ({ id: RECIPE, slug: "plain", sauceLesson: null }) };
    await POST(new Request("http://127.0.0.1:3030/api/cook", { method: "POST", body: JSON.stringify({ recipeId: RECIPE, rating: 4, confidence: 4, sauceRating: 5 }) }));
    expect(data).toMatchObject({ sauceLessonSlug: null, sauceRating: null });
  });
});
