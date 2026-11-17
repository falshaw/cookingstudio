// DB-backed lib modules against the in-memory Prisma stand-in.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";

const h = vi.hoisted(() => ({ overrides: {} as Overrides, cookies: new Map<string, string>() }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return makePrisma(h.overrides).client;
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (h.cookies.has(k) ? { value: h.cookies.get(k) } : undefined),
    set: (k: string, v: string) => void h.cookies.set(k, v),
    delete: (k: string) => void h.cookies.delete(k),
  }),
}));

const flags = { isMeat: false, isFish: false, isOmega3: false, isAlcohol: false, isAddedSugar: false, isRefinedStarch: false };
const ing = (slug: string, nameEn: string, fdcId: number | null, extra: Partial<typeof flags> = {}) => ({ id: `c${slug.replace(/[^a-z]/g, "").padEnd(24, "0").slice(0, 24)}`, slug, nameEn, fdcId, imageId: null, section: "produce", packQty: 250, packUnit: "g", packLabel: "250 g", freezable: true, ...flags, ...extra });
const refs = [
  { fdcId: 1, name: "Courgette", kcal: 17, protein: 1.2, carbs: 3.1, fat: 0.3, satFat: 0.1, fibre: 1, sugar: 2.5, b12: 0, iron: 0.4, zinc: 0.3, ala: 0.01, magnesium: 18, vitD: 0, epa: 0, dha: 0, mufa: 0.01, pufa: 0.1 },
  { fdcId: 2, name: "Salmon", kcal: 208, protein: 20, carbs: 0, fat: 13, satFat: 3, fibre: 0, sugar: 0, b12: 3.2, iron: 0.3, zinc: 0.4, ala: 0.1, magnesium: 27, vitD: 11, epa: 0.9, dha: 1.1, mufa: 3.8, pufa: 4 },
  { fdcId: 3, name: "Rice", kcal: 365, protein: 7, carbs: 80, fat: 0.7, satFat: 0.2, fibre: 1.3, sugar: 0.1, b12: 0, iron: 0.8, zinc: 1.1, ala: 0, magnesium: 25, vitD: 0, epa: 0, dha: 0, mufa: 0.2, pufa: 0.2 },
];
const recipe = (id: string, slug: string, kind = "plan", mealTypes = ["lunch", "dinner"]) => ({
  id, slug, title: slug, kind, mealTypes, servings: 2, prepMinutes: 10, cookMinutes: 15, status: "published",
  ingredients: [
    { id: `${id}a`, component: "both", grams: 400, qty: 400, unit: "g", ingredientId: "ccourgette", ingredient: ing("courgette", "Courgette", 1) },
    { id: `${id}b`, component: "alex", grams: 150, qty: 150, unit: "g", ingredientId: "csalmon", ingredient: ing("salmon", "Salmon fillet", 2, { isFish: true, isOmega3: true }) },
    { id: `${id}c`, component: "sam", grams: 75, qty: 75, unit: "g", ingredientId: "cbasmatirice", ingredient: ing("basmati-rice", "Basmati rice", 3, { isRefinedStarch: true }) },
  ],
  steps: [],
});
const alexProfile = { vegetarian: false, vegBreakfastAllowed: [], avoidFoods: ["celery"], noAlcohol: true, noAddedSugar: false, noRefinedStarch: true, maxNetCarbsPerMeal: 50, minProteinPerMeal: 22, maxCookMinutes: 40, omega3MinPerWeek: 2, omega3MaxPerWeek: 3, portionFactor: 1, trackedNutrients: ["magnesium", "vitD", "fibre"], tasteOverrides: { likes: ["thai"], dislikes: [] }, practiceGoalPerWeek: 3, nextLabDate: new Date("2026-12-07T00:00:00Z") };
const samProfile = { ...alexProfile, vegetarian: true, vegBreakfastAllowed: ["bacon"], avoidFoods: [], noAlcohol: false, noAddedSugar: false, noRefinedStarch: false, maxNetCarbsPerMeal: null, minProteinPerMeal: null, maxCookMinutes: null, omega3MinPerWeek: null, omega3MaxPerWeek: null, trackedNutrients: ["b12", "iron"] };
const users = [
  { id: "calex00000000000000000000001", slug: "alex", name: "Alex", email: "alex@kitchen.local", profile: alexProfile },
  { id: "csam000000000000000000001", slug: "sam", name: "Sam", email: "sam@kitchen.local", profile: samProfile },
];
const recipes = [recipe("crecipeaaaaaaaaaaaaaaaaaaa1", "salmon-tray"), recipe("crecipebbbbbbbbbbbbbbbbbbb1", "fish-bowl"), recipe("crecipeccccccccccccccccccc1", "yogurt", "plan", ["breakfast"])];

beforeEach(() => {
  h.cookies.clear();
  h.overrides = {
    user: { findMany: async () => users, findUnique: async () => users[0], findUniqueOrThrow: async () => users[0] },
    recipe: { findMany: async () => recipes, findUnique: async () => recipes[0] },
    nutritionRef: { findMany: async () => refs },
  };
});

describe("planner", () => {
  it("loads candidates with per-person macros and solves a full, fish-balanced week", async () => {
    const { loadCandidates, solveWeek, evaluateWeek } = await import("@/lib/planner");
    const { loadProfiles, toRuleProfile } = await import("@/lib/recipe-data");
    const people = (await loadProfiles()).map(toRuleProfile);
    const cands = await loadCandidates({ alex: 1, sam: 1 });
    expect(cands[0].macros.alex.protein).toBeCloseTo(32.4, 1); // 150 g salmon (30 g) + half of 400 g courgette (2.4 g)
    const week = solveWeek(cands, people, [], 7, new Set([cands[0].id]));
    const rep = evaluateWeek(week, new Map(cands.map((c) => [c.slug, c])), people);
    expect(week.filter((s) => s.meal === "breakfast").every((s) => s.slug === "yogurt")).toBe(true); // only breakfast-type recipes at breakfast
    expect(rep.omega3.alex).toBeLessThanOrEqual(3);
    // every test candidate is oily fish: the solver stops at the weekly max (3) instead of breaking the rule
    expect(week).toHaveLength(3);
    expect(rep.ok).toBe(true);
  });
  it("flags unknown recipes and wrong meal types", async () => {
    const { evaluateWeek, loadCandidates, slotIssues } = await import("@/lib/planner");
    const { loadProfiles, toRuleProfile } = await import("@/lib/recipe-data");
    const people = (await loadProfiles()).map(toRuleProfile);
    const cands = await loadCandidates({ alex: 1, sam: 1 });
    const rep = evaluateWeek([{ day: 0, meal: "dinner", slug: "ghost" }], new Map(cands.map((c) => [c.slug, c])), people);
    expect(rep.ok).toBe(false);
    expect(rep.slots[0].issues[0].code).toBe("unknown");
    expect(slotIssues(cands[0], "breakfast", people, false).some((i) => i.code === "meal")).toBe(true);
  });
});

describe("plan actions", () => {
  const plan = { id: "cplan0000000000000000000001", slots: [
    { id: "cslot0000000000000000000001", day: 0, meal: "dinner", recipeId: recipes[0].id, source: "fresh", recipe: recipes[0] },
    { id: "cslot0000000000000000000002", day: 1, meal: "dinner", recipeId: recipes[1].id, source: "fresh", recipe: recipes[1] },
  ] };
  beforeEach(() => {
    h.overrides.mealSlot = { findUnique: async (a: { where: { id: string } }) => { const s = plan.slots.find((x) => x.id === a.where.id); return s ? { ...s, planId: plan.id, plan } : null; } };
    h.overrides.mealPlan = { findUnique: async () => plan, upsert: async () => ({ id: plan.id }) };
  });
  it("swaps a slot for another passing recipe", async () => {
    const { swapSlot } = await import("@/lib/plan-actions");
    expect(await swapSlot("cslot0000000000000000000001")).toBe("fish-bowl");
  });
  it("only takes leftovers from an earlier meal", async () => {
    const { applyLeftovers, PlanActionError } = await import("@/lib/plan-actions");
    await expect(applyLeftovers("cslot0000000000000000000001", "cslot0000000000000000000002")).rejects.toBeInstanceOf(PlanActionError);
    await expect(applyLeftovers("cslot0000000000000000000002", "cslot0000000000000000000001")).resolves.toBeUndefined();
  });
  it("404s an unknown slot and solves an instant week", async () => {
    const { lockSlot, setSlot, solveInstantWeek } = await import("@/lib/plan-actions");
    await expect(lockSlot("cmissing00000000000000000001", true)).rejects.toMatchObject({ status: 404 });
    await expect(setSlot("cslot0000000000000000000001", recipes[1].id)).resolves.toBeUndefined();
    const r = await solveInstantWeek(new Date("2026-10-19T00:00:00Z"));
    expect(r.planId).toBe(plan.id);
  });
});

describe("recipe view, data and shopping build", () => {
  it("builds the recipe page model with per-person checks and stock", async () => {
    h.overrides.recipe = { findUnique: async () => ({ ...recipes[0], description: "", level: 3, equipment: [], sauceFamily: null, troubleshoot: [{ problem: "p", fix: "f" }], goesWith: "", variantNote: "", fridgeDays: 2, freezerDays: 0, reheat: "", leftoverIdeas: "", hero: null, steps: [{ n: 1, text: "Simmer 10 minutes", why: "", cue: "", mistake: "", who: "alex", minutes: 10, timerSeconds: 0, technique: "reduce", image: null, ingredientIds: [] }] }) };
    h.overrides.stockItem = { findMany: async () => [{ ingredientId: "ccourgette", status: "in" }] };
    h.overrides.technique = { findMany: async () => [{ slug: "reduce", title: "Reducing" }] };
    h.overrides.cookLog = { findMany: async () => [{ recipeId: recipes[0].id, user: { id: users[0].id, name: "Alex" }, confidence: 3, tweak: "less salt" }] };
    const { recipeVM } = await import("@/lib/recipe-view");
    const vm = (await recipeVM("salmon-tray", users[0].id))!;
    expect(vm.steps[0].timers[0].seconds).toBe(600);
    expect(vm.steps[0].techniqueTitle).toBe("Reducing");
    expect(vm.issues.sam.some((i) => i.code === "vegetarian")).toBe(false);
    expect(vm.missing).toEqual(["Salmon fillet", "Basmati rice"]);
    expect(vm.lastTweak).toBe("less salt");
    expect(vm.practice[0].count).toBe(1);
  });
  it("merges a recipe list into a shopping list with supermarket packs", async () => {
    h.overrides.stockItem = { findMany: async () => [] };
    h.overrides.ingredient = { findMany: async () => [{ ...ing("courgette", "Courgette", 1), id: "ccourgette" }] };
    const { buildFromRecipes, saveList } = await import("@/lib/shopping-build");
    const { items, leftOut } = await buildFromRecipes([{ recipeId: recipes[0].id, servings: 4 }]);
    expect(leftOut).toEqual([]);
    const courgette = items.find((i) => i.name === "Courgette")!;
    expect(courgette.qty).toBe(800);
    expect(courgette.packNote).toMatch(/buy 4 × 250 g/);
    expect(items.find((i) => i.forWho === "alex")?.name).toBe("Salmon fillet");
    await expect(saveList("Test", "recipes", items)).resolves.toBeTruthy();
  });
  it("leaves out Alex's own extra on his avoid list and tags a shared one", async () => {
    h.overrides.stockItem = { findMany: async () => [] };
    h.overrides.user = { findMany: async () => [{ ...users[0], profile: { ...alexProfile, avoidFoods: ["salmon", "courgette"] } }, users[1]] };
    const { buildFromRecipes } = await import("@/lib/shopping-build");
    const { items, leftOut } = await buildFromRecipes([{ recipeId: recipes[0].id, servings: 2 }]);
    expect(leftOut).toEqual(["Salmon fillet (Alex avoids)"]);
    expect(items.some((i) => i.name === "Salmon fillet")).toBe(false);
    expect(items.find((i) => i.name === "Courgette")?.avoidNote).toBe("Alex avoids");
  });
  it("builds a list from a plan with prep batches and buys for leftover lunches (cook double)", async () => {
    h.overrides.mealPlan = { findUnique: async () => ({ id: "cp", slots: [{ recipeId: recipes[0].id, source: "fresh" }, { recipeId: recipes[1].id, source: "leftover" }], batches: [{ recipeId: recipes[1].id, portions: 6 }] }) };
    h.overrides.userProfile = { findMany: async () => [{ portionFactor: 1, user: { slug: "alex" } }, { portionFactor: 1, user: { slug: "sam" } }] };
    const { buildFromPlan } = await import("@/lib/shopping-build");
    const { items } = await buildFromPlan("cp");
    expect(items.find((i) => i.name === "Courgette" && i.forWho === "base")!.qty).toBe(2000); // 400 fresh + 400 leftover lunch + 1200 batch
  });
  it("finds the best USDA match for a search term", async () => {
    h.overrides.nutritionRef = { findMany: async () => [{ fdcId: 7, name: "Onions, raw" }, { fdcId: 8, name: "Onions, dehydrated flakes, babyfood" }] };
    const { findNutrition } = await import("@/lib/nutrition-search");
    expect(await findNutrition("onions raw")).toEqual({ fdcId: 7, name: "Onions, raw" });
    expect(await findNutrition("x")).toBeNull();
  });
});

describe("recipe save", () => {
  it("resolves ingredients, links steps and queues images", async () => {
    const created: string[] = [];
    h.overrides.ingredient = { findUnique: async () => null, findFirst: async () => null, create: async (a: { data: { slug: string } }) => (created.push(a.data.slug), { id: "cnewing000000000000000000001", ...a.data }) };
    h.overrides.recipeIngredient = { create: async (a: { data: Record<string, unknown> }) => ({ id: "cri", ...a.data, ingredient: { nameEn: "Cherry tomatoes" } }) };
    const { saveRecipe, ingredientKey, stepIngredientIds } = await import("@/lib/recipe-save");
    const { client } = makePrisma(h.overrides);
    const r = await saveRecipe(client as never, { title: "T", description: "", servings: 2, prepMinutes: 1, cookMinutes: 1, fridgeDays: 2, freezerDays: 0, reheat: "", troubleshoot: [], goesWith: "", equipment: [], cuisine: "", protein: "", flavourTags: [], spiceLevel: 0, sauceLesson: "", ingredients: [{ name: "Cherry tomatoes", grams: 200, qty: 200, unit: "g", prep: "", component: "both" }], steps: [{ text: "Halve the tomatoes", why: "", cue: "", mistake: "", who: "sam", minutes: 2, technique: "none", timerSeconds: 0, imagePrompt: "" }] }, { slug: "t", level: 1, kind: "lesson", mealTypes: ["dinner"], source: "teach" });
    expect(r.newIngredients).toHaveLength(1);
    expect(created).toEqual(["cherry-tomato"]);
    expect(ingredientKey("Large ripe Potatoes")).toBe("potato");
    expect(stepIngredientIds("Add the cherry tomatoes", [{ id: "x", nameEn: "Cherry tomatoes" }])).toEqual(["x"]);
  });
});

describe("health stats and report numbers", () => {
  beforeEach(() => {
    h.overrides.mealPlan = { findUnique: async () => ({ id: "cp", slots: [{ day: 0, meal: "dinner", recipeId: recipes[0].id }, { day: 1, meal: "dinner", recipeId: recipes[0].id }] }) };
    h.overrides.weightEntry = { findMany: async () => [{ date: new Date("2026-10-10T00:00:00Z"), kg: 80 }, { date: new Date("2026-10-19T00:00:00Z"), kg: 79 }] };
  });
  it("computes nutrients, glycemic load (GI foods only) and fish per person", async () => {
    const { weekStats, glDayBand, glMealBand } = await import("@/lib/health-stats");
    const alex = await weekStats(users[0]);
    const sam = await weekStats(users[1]);
    expect(alex.fish).toBe(2);
    expect(sam.fish).toBe(0);
    expect(alex.days[0].gl).toBe(0); // courgette has no GI → not counted
    expect(alex.days[0].uncountedCarbs).toBeGreaterThan(0);
    expect(sam.days[0].gl).toBe(Math.round((58 * (80 - 1.3) * 0.75) / 100)); // basmati GI 58
    expect(alex.dailyAvg.vitD).toBeCloseTo(16.5, 1);
    expect(glDayBand(70)).toBe("green");
    expect(glDayBand(100)).toBe("amber");
    expect(glMealBand(25)).toBe("high");
  });
  it("assembles the weekly report numbers without lab values", async () => {
    const { reportNumbers } = await import("@/lib/report");
    const n = await reportNumbers(users[0].id);
    expect(n.weight?.latest).toBe(79);
    expect(n.gaps.map((g) => g.label)).toEqual(["Magnesium", "Vitamin D (from food)", "Fibre"]);
    expect(n.nextLab).toBe("2026-12-07");
    expect(JSON.stringify(n)).not.toMatch(/HbA1c/);
  });
  it("smooths weights over 7 days", async () => {
    const { smoothWeights } = await import("@/lib/health-stats");
    const s = smoothWeights([{ date: "2026-10-01", kg: 72 }, { date: "2026-10-03", kg: 70 }, { date: "2026-10-20", kg: 68 }]);
    expect(s.map((x) => x.trend)).toEqual([72, 71, 68]);
  });
});

describe("auth session (DB-backed)", () => {
  it("creates a session cookie, reads it back, and deletes it", async () => {
    const { createSession, getSession, currentUser, deleteSession, requireUserId, sessionKey } = await import("@/lib/auth");
    let stored: { token: string; expiresAt: Date } | null = null;
    h.overrides.session = {
      create: async (a: { data: { token: string; expiresAt: Date } }) => ((stored = a.data), a.data),
      findUnique: async () => stored,
    };
    const token = await createSession(users[0].id, users[0].email);
    expect(h.cookies.get("kitchen_session")).toBe(token);
    expect(stored!.token).toBe(sessionKey(token));
    expect((await getSession())?.userId).toBe(users[0].id);
    expect(await requireUserId()).toBe(users[0].id);
    expect((await currentUser())?.slug).toBe("alex");
    await deleteSession();
    expect(h.cookies.has("kitchen_session")).toBe(false);
    expect(await getSession()).toBeNull();
  });
  it("refuses placeholder secrets", async () => {
    const old = process.env.JWT_SECRET;
    process.env.JWT_SECRET = "changeme-changeme-changeme-changeme-changeme";
    const { createToken } = await import("@/lib/auth");
    await expect(createToken({ userId: "u", email: "e" })).rejects.toThrow(/weak/);
    process.env.JWT_SECRET = old;
  });
  it("lockout: counts failures and locks on the fifth", async () => {
    const { registerFailure, clearFailures } = await import("@/lib/lockout");
    h.overrides.user = { ...h.overrides.user, updateMany: async () => ({ count: 1 }), update: async () => ({}) };
    expect((await registerFailure("u", 1)).locked).toBe(false);
    expect((await registerFailure("u", 4)).locked).toBe(true);
    await expect(clearFailures("u")).resolves.toBeUndefined();
  });
});

describe("feed scheduling, settings and taste", () => {
  it("reads settings with defaults and only schedules when due and Ollama is up", async () => {
    const created: unknown[] = [];
    h.overrides.setting = { findUnique: async (a: { where: { key: string } }) => (a.where.key === "feed.lastRun" ? { value: new Date().toISOString() } : null), upsert: async () => ({}) };
    h.overrides.job = { findFirst: async () => null, create: async (a: unknown) => (created.push(a), {}) };
    const { getSetting, maybeScheduleFeed } = await import("@/lib/feed");
    expect(await getSetting("feed.perWeek", 3)).toBe(3);
    await maybeScheduleFeed();
    expect(created).toHaveLength(0); // ran just now → not due
  });
  it("picks a sauce gap after the weekly meal-prep recipe exists", async () => {
    let n = 0;
    h.overrides.recipe = { count: async () => (++n === 1 ? 1 : n === 2 ? 1 : 0) };
    h.overrides.equipment = { findMany: async () => [{ slug: "slow-cooker" }] };
    h.overrides.stockItem = { findMany: async () => [] };
    const { pickGap } = await import("@/lib/feed");
    const g = await pickGap();
    expect(g.kind).toBe("sauce");
    expect(g.sauceFamily).toBeTruthy();
  });
  it("computes a taste profile from favourites, cooks and overrides", async () => {
    h.overrides.favourite = { findMany: async () => [{ recipeId: recipes[0].id }] };
    h.overrides.cookLog = { findMany: async () => [{ recipeId: recipes[0].id, rating: 5, tweak: "more lemon" }] };
    h.overrides.userProfile = { findUnique: async () => ({ tasteOverrides: { likes: ["thai"], dislikes: ["okra"] } }) };
    h.overrides.recipe = { findMany: async () => [{ ...recipes[0], cuisine: "Thai", protein: "salmon", sauceFamily: null, flavourTags: ["lemony"], spiceLevel: 0, steps: [{ technique: "sear" }] }] };
    const { tasteFor } = await import("@/lib/taste");
    const t = await tasteFor(users[0].id);
    expect(t.cuisines[0][0]).toBe("thai");
    expect(t.overrides.dislikes).toEqual(["okra"]);
    expect(t.tweakWords).toContain("more lemon");
  });
  it("practice map and make-again list", async () => {
    h.overrides.cookLog = { findMany: async () => [{ recipeId: "r1", confidence: 2, cookedAt: new Date(), tweak: "" }, { recipeId: "r2", confidence: 5, cookedAt: new Date(), tweak: "x" }] };
    const { practiceMap, makeAgain } = await import("@/lib/practice");
    const pm = await practiceMap("u");
    expect(makeAgain([{ id: "r1" }, { id: "r2" }, { id: "r3" }], pm).map((r) => r.id)).toEqual(["r1"]);
  });
});

describe("dislikes (👎)", () => {
  it("a disliked recipe counts as a rejection and a disliked ingredient lands in the taste dislikes", async () => {
    h.overrides.favourite = { findMany: async () => [] };
    h.overrides.cookLog = { findMany: async () => [] };
    h.overrides.userProfile = { findUnique: async () => ({ tasteOverrides: null }) };
    h.overrides.dislike = { findMany: async () => [{ recipeId: recipes[0].id, ingredient: null }, { recipeId: null, ingredient: { nameEn: "Okra" } }] };
    h.overrides.recipe = { findMany: async () => [{ ...recipes[0], cuisine: "Indian", protein: "chicken", sauceFamily: "curry", flavourTags: ["spiced"], spiceLevel: 2, steps: [] }] };
    const { tasteFor } = await import("@/lib/taste");
    const t = await tasteFor(users[1].id);
    expect(t.dislikes).toContain("okra");
    expect(t.dislikes).toContain("chicken");
    expect(t.cuisines).toEqual([]);
  });
  it("one person's dislike keeps a dish out of shared planning; an ingredient dislike acts like their avoid list", async () => {
    const { toRuleProfile } = await import("@/lib/recipe-data");
    const { loadCandidates, slotIssues } = await import("@/lib/planner");
    const sam = toRuleProfile({ ...users[1], dislikes: [{ recipeId: recipes[0].id, ingredient: null }, { recipeId: null, ingredient: { slug: "courgette" } }] });
    const alex = toRuleProfile(users[0]);
    expect(sam.avoidFoods).toContain("courgette");
    const cands = await loadCandidates({ alex: 1, sam: 1 });
    const issues = slotIssues(cands[0], "dinner", [alex, sam], false);
    expect(issues.some((i) => i.code === "disliked" && i.who === "sam")).toBe(true);
    expect(issues.some((i) => i.code === "avoid" && i.who === "sam")).toBe(true);
  });
});
