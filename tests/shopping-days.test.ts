// Shopping list for chosen plan days: buildFromPlan(planId, days) + POST /api/shopping {days}.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";

const h = vi.hoisted(() => ({ overrides: {} as Overrides }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return makePrisma(h.overrides).client;
  },
}));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => ({ id: "calex00000000000000000000001", slug: "alex", name: "Alex", email: "n@k" })) }));

const { buildFromPlan, daysLabel, pickPlanDays } = await import("@/lib/shopping-build");
const { POST } = await import("@/app/api/shopping/route");

const slot = (day: number, recipeId: string, source = "fresh", prepBatchId: string | null = null) => ({ day, meal: "dinner", recipeId, source, prepBatchId });
const SLOTS = [slot(0, "pasta"), slot(1, "stew", "prep", "b1"), slot(2, "stew", "prep", "b1"), slot(3, "curry"), slot(4, "sauce", "freezer", "frozen"), slot(5, "pasta", "leftover")];
const BATCHES = [{ id: "b1", recipeId: "stew", portions: 6, prepDay: 6 }, { id: "b2", recipeId: "soup", portions: 4, prepDay: 3 }];

describe("pickPlanDays", () => {
  it("whole week = every fresh slot + every batch (unchanged behaviour)", () => {
    const r = pickPlanDays(SLOTS, BATCHES);
    expect(r.slots.map((s) => s.recipeId)).toEqual(["pasta", "curry", "pasta"]); // leftover lunch is bought too (cook double)
    expect(r.batches.map((b) => b.id)).toEqual(["b1", "b2"]);
  });
  it("chosen days: their fresh slots, a batch eaten on them or cooked on them, leftovers bought, nothing for freezer", () => {
    expect(pickPlanDays(SLOTS, BATCHES, [0, 1])).toMatchObject({ slots: [{ recipeId: "pasta" }], batches: [{ id: "b1" }] });
    expect(pickPlanDays(SLOTS, BATCHES, [3])).toMatchObject({ slots: [{ recipeId: "curry" }], batches: [{ id: "b2" }] }); // b2 cooked Thursday
    expect(pickPlanDays(SLOTS, BATCHES, [4, 5])).toMatchObject({ slots: [{ recipeId: "pasta", source: "leftover" }], batches: [] });
    expect(pickPlanDays(SLOTS, BATCHES, [4])).toEqual({ slots: [], batches: [] });
  });
  it("labels the list", () => {
    expect(daysLabel([0, 1])).toBe("Mon, Tue");
    expect(daysLabel([2, 0, 1])).toBe("Mon–Wed");
    expect(daysLabel([0, 2, 4])).toBe("Mon, Wed, Fri");
    expect(daysLabel(undefined)).toBe("");
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe("");
  });
});

const ingredient = (id: string) => ({ id, slug: id, nameEn: id, section: "produce", packQty: null, packUnit: "", packLabel: "", freezable: false });
const recipe = (id: string, ing: string) => ({ id, title: id, servings: 2, cuisine: "", flavourTags: [], sauceFamily: null, ingredients: [{ ingredientId: ing, component: "both", qty: 200, unit: "g", ingredient: ingredient(ing) }] });

beforeEach(() => {
  h.overrides = {
    mealPlan: { findUnique: async () => ({ id: "cplan0000000000000000000001", weekStart: new Date("2026-11-09T00:00:00Z"), slots: SLOTS, batches: BATCHES }) },
    recipe: { findMany: async (a: { where: { id: { in: string[] } } }) => [recipe("pasta", "tomato"), recipe("stew", "beef"), recipe("curry", "chicken"), recipe("soup", "leek")].filter((r) => a.where.id.in.includes(r.id)) },
    userProfile: { findMany: async () => [{ portionFactor: 1, user: { slug: "alex" } }, { portionFactor: 1, user: { slug: "sam" } }] },
    ingredient: { findMany: async (a: { where: { id: { in: string[] } } }) => a.where.id.in.map(ingredient) },
  };
});

describe("buildFromPlan with days", () => {
  it("Mon + Tue buys Monday's dinner and Tuesday's prep batch only", async () => {
    const { items } = await buildFromPlan("cplan0000000000000000000001", [0, 1]);
    expect(items.map((i) => i.ingredientId).sort()).toEqual(["beef", "tomato"]);
    expect(items.find((i) => i.ingredientId === "beef")?.qty).toBe(600); // 6-portion batch once, not per day
  });
  it("no days argument = whole week", async () => {
    const { items } = await buildFromPlan("cplan0000000000000000000001");
    expect(items.map((i) => i.ingredientId).sort()).toEqual(["beef", "chicken", "leek", "tomato"]);
  });
});

describe("POST /api/shopping {from: plan, days}", () => {
  const post = (body: unknown) => new Request("http://127.0.0.1:3030/api/shopping", { method: "POST", body: JSON.stringify(body) });
  it("names the list after the chosen days", async () => {
    let name = "";
    h.overrides.shoppingList = { create: async (a: { data: { name: string } }) => ((name = a.data.name), { id: "clist0000000000000000000001", ...a.data }) };
    const res = await POST(post({ from: "plan", planId: "cplan0000000000000000000001", days: [1, 0, 1] }));
    expect(res.status).toBe(200);
    expect(name).toMatch(/^Week of 2026-11-09 · Mon, Tue · \d\d:\d\d$/);
  });
  it("refuses days outside 0–6 and an empty day list", async () => {
    expect((await POST(post({ from: "plan", planId: "cplan0000000000000000000001", days: [7] }))).status).toBe(400);
    expect((await POST(post({ from: "plan", planId: "cplan0000000000000000000001", days: [] }))).status).toBe(400);
  });
});
