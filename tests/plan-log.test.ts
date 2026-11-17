// "Ate today's plan" one-tap + editing a food-log entry. Fake Prisma with an in-memory
// FoodLog table that enforces the (userId, planKey) unique key the way Postgres does (P2002).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";
import { dayIndex, planKey, slotsToLog, type PlanSlotLite } from "@/lib/plan-log";
import { editedEntry, type EditableEntry } from "@/lib/food-log";

const ALEX = { id: "calex00000000000000000000001", slug: "alex", name: "Alex", email: "n@k" };
const SAM = { id: "csam000000000000000000001", slug: "sam", name: "Sam", email: "a@k" };
const h = vi.hoisted(() => ({ overrides: {} as Overrides, user: null as null | { id: string; slug: string; name: string; email: string } }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return makePrisma(h.overrides).client;
  },
}));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => h.user) }));
vi.mock("@/lib/utils", async (orig) => ({ ...(await orig<typeof import("@/lib/utils")>()), localDay: () => "2026-11-10" }));

const { POST: atePlan } = await import("@/app/api/food-log/plan/route");
const { PATCH: patchEntry } = await import("@/app/api/food-log/route");

const slot = (meal: string, day: number, o: Partial<PlanSlotLite> = {}): PlanSlotLite => ({ id: `cslot${meal}${day}`.padEnd(26, "0"), day, meal, recipeId: "crecipe000000000000000000001", source: "fresh", prepBatchId: null, ...o });

describe("plan-log helpers", () => {
  it("keys a slot by week + day + meal, and maps a date onto the plan week", () => {
    expect(planKey("2026-11-09", 1, "lunch")).toBe("2026-11-09:1:lunch");
    expect(dayIndex("2026-11-09", "2026-11-09")).toBe(0);
    expect(dayIndex("2026-11-09", "2026-11-15")).toBe(6);
    expect(dayIndex("2026-11-09", "2026-11-16")).toBeNull();
    expect(dayIndex("2026-11-09", "2026-11-08")).toBeNull();
  });
  it("logs only that day's slots, in meal order, and skips keys already logged", () => {
    const slots = [slot("dinner", 1), slot("breakfast", 1), slot("lunch", 1), slot("lunch", 2)];
    expect(slotsToLog(slots, "2026-11-09", 1, new Set()).map((x) => x.slot.meal)).toEqual(["breakfast", "lunch", "dinner"]);
    expect(slotsToLog(slots, "2026-11-09", 1, new Set(["2026-11-09:1:breakfast"])).map((x) => x.key)).toEqual(["2026-11-09:1:lunch", "2026-11-09:1:dinner"]);
  });
});

describe("editedEntry (PATCH /api/food-log)", () => {
  const e: EditableEntry = { meal: "lunch", label: "Bolognese × 2", recipeId: "crec", portions: 2, kcal: 1200, protein: 80, netCarbs: 20, fat: 40, date: new Date("2026-11-10T00:00:00Z"), planKey: null };
  it("scales kcal + macros with the portions and rewrites the × suffix", () => {
    expect(editedEntry(e, { portions: 1 })).toEqual({ portions: 1, kcal: 600, protein: 40, netCarbs: 10, fat: 20, label: "Bolognese" });
    expect(editedEntry({ ...e, portions: 1, label: "Egg 100 g" }, { portions: 1.5 })).toMatchObject({ label: "Egg 100 g × 1.5", kcal: 1800 });
  });
  it("renames, moves meal / day, and drops the plan link when moved", () => {
    expect(editedEntry(e, { label: "Mum's bolognese" })).toEqual({ label: "Mum's bolognese × 2" });
    const linked = { ...e, planKey: "2026-11-09:1:lunch" };
    expect(editedEntry(linked, { meal: "dinner" })).toEqual({ meal: "dinner", planKey: null });
    expect(editedEntry(linked, { date: "2026-11-09" })).toEqual({ date: new Date("2026-11-09T00:00:00Z"), planKey: null });
    expect(editedEntry(linked, { meal: "lunch", date: "2026-11-10", portions: 2 })).toEqual({}); // nothing really changed
  });
});

// ---- route tests on an in-memory database ----
type Row = Record<string, unknown> & { id: string; userId: string; planKey: string | null };
let logs: Row[];
let batch: { id: string; portions: number; eaten: number };
const RECIPE = { id: "crecipe000000000000000000001", title: "Bolognese", servings: 2, ingredients: [{ component: "both", grams: 400, ingredient: { fdcId: 1 } }] };
const SAUCE_BATCH = "cbatch00000000000000000001";
const plan = (slots: PlanSlotLite[]) => ({ id: "cplan0000000000000000000001", weekStart: new Date("2026-11-09T00:00:00Z"), slots: slots.map((s) => ({ ...s, recipe: { title: s.source === "freezer" ? "Bolognese sauce" : "Bolognese" } })) });
const req = (method: string, body: unknown) => new Request("http://127.0.0.1:3030/api/food-log", { method, body: JSON.stringify(body) });

function db(slots: PlanSlotLite[]) {
  h.overrides = {
    mealPlan: { findMany: async () => [plan(slots)] },
    recipe: { findUnique: async () => RECIPE },
    nutritionRef: { findMany: async () => [{ fdcId: 1, kcal: 150, protein: 20, carbs: 2, fat: 7, fibre: 0 }] },
    foodLog: {
      findMany: async (a: { where: { userId: string; planKey: { in: string[] } } }) => logs.filter((r) => r.userId === a.where.userId && a.where.planKey.in.includes(r.planKey ?? "")),
      findFirst: async (a: { where: { id: string; userId: string } }) => logs.find((r) => r.id === a.where.id && r.userId === a.where.userId) ?? null,
      create: async (a: { data: Row }) => {
        if (a.data.planKey && logs.some((r) => r.userId === a.data.userId && r.planKey === a.data.planKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const row = { ...a.data, id: `clog${String(logs.length).padStart(22, "0")}` };
        logs.push(row);
        return row;
      },
      updateMany: async (a: { where: { id: string; userId: string }; data: Record<string, unknown> }) => {
        const r = logs.find((x) => x.id === a.where.id && x.userId === a.where.userId);
        if (r) Object.assign(r, a.data);
        return { count: r ? 1 : 0 };
      },
    },
    prepBatch: {
      findUnique: async () => batch,
      updateMany: async (a: { where: { id: string; eaten: { lt: number } }; data: { eaten: { increment: number } } }) => {
        if (a.where.id !== batch.id || !(batch.eaten < a.where.eaten.lt)) return { count: 0 };
        batch.eaten += a.data.eaten.increment;
        return { count: 1 };
      },
    },
  };
}

beforeEach(() => {
  logs = [];
  batch = { id: SAUCE_BATCH, portions: 6, eaten: 2 };
  h.user = ALEX;
});

describe("POST /api/food-log/plan", () => {
  const today = [slot("breakfast", 1), slot("lunch", 1), slot("dinner", 1, { source: "freezer", prepBatchId: SAUCE_BATCH }), slot("dinner", 2)];

  it("logs my portion of every planned slot of the day and takes one frozen portion off the batch", async () => {
    db(today);
    const res = await atePlan(req("POST", { date: "2026-11-10" }));
    expect(await res.json()).toEqual({ ok: true, logged: 3, skipped: 0, fromFreezer: 1 });
    expect(logs.map((r) => [r.meal, r.planKey, r.userId])).toEqual([
      ["breakfast", "2026-11-09:1:breakfast", ALEX.id],
      ["lunch", "2026-11-09:1:lunch", ALEX.id],
      ["dinner", "2026-11-09:1:dinner", ALEX.id],
    ]);
    expect(logs[2].label).toBe("Bolognese (from the freezer)");
    expect(logs[0]).toMatchObject({ portions: 1, kcal: 300, protein: 40 }); // 400 g shared base ÷ 2 servings = 200 g
    expect(batch.eaten).toBe(3);
  });

  it("a second tap logs nothing and takes nothing more off the freezer", async () => {
    db(today);
    await atePlan(req("POST", { date: "2026-11-10" }));
    const res = await atePlan(req("POST", { date: "2026-11-10" }));
    expect(await res.json()).toEqual({ ok: true, logged: 0, skipped: 3, fromFreezer: 0 });
    expect(logs).toHaveLength(3);
    expect(batch.eaten).toBe(3);
  });

  it("each person logs their own portion once — Sam's tap does not see or skip Alex's rows", async () => {
    db(today);
    await atePlan(req("POST", { date: "2026-11-10" }));
    h.user = SAM;
    const res = await atePlan(req("POST", { date: "2026-11-10" }));
    expect((await res.json()).logged).toBe(3);
    expect(logs.filter((r) => r.userId === SAM.id)).toHaveLength(3);
    expect(batch.eaten).toBe(4); // dinner for two = 2 portions off the batch in total
  });

  it("an empty batch is never driven below zero portions left", async () => {
    db(today);
    batch.eaten = 6;
    expect((await (await atePlan(req("POST", { date: "2026-11-10" }))).json()).fromFreezer).toBe(0);
    expect(batch.eaten).toBe(6);
  });

  it("a parallel tap that loses the unique-key race counts as skipped, not as an error", async () => {
    db(today);
    logs.push({ id: "clogearly00000000000000001", userId: ALEX.id, planKey: "2026-11-09:1:lunch" });
    const origFind = (h.overrides.foodLog as Record<string, unknown>).findMany;
    (h.overrides.foodLog as Record<string, unknown>).findMany = async () => []; // the other tap's row was not visible yet
    const res = await atePlan(req("POST", { date: "2026-11-10" }));
    expect(await res.json()).toMatchObject({ logged: 2, skipped: 1 });
    (h.overrides.foodLog as Record<string, unknown>).findMany = origFind;
  });

  it("refuses a future day, a day without a plan, and a signed-out caller", async () => {
    db(today);
    expect((await atePlan(req("POST", { date: "2026-11-11" }))).status).toBe(400);
    expect((await atePlan(req("POST", { date: "2026-02-31" }))).status).toBe(400);
    h.overrides.mealPlan = { findMany: async () => [] };
    expect((await atePlan(req("POST", { date: "2026-11-10" }))).status).toBe(404);
    h.user = null;
    expect((await atePlan(req("POST", { date: "2026-11-10" }))).status).toBe(401);
  });
});

describe("PATCH /api/food-log", () => {
  const mineRow = (): Row => ({ id: "clogmine000000000000000001", userId: ALEX.id, planKey: "2026-11-09:1:lunch", meal: "lunch", label: "Bolognese", recipeId: "crec", portions: 1, kcal: 600, protein: 40, netCarbs: 10, fat: 20, date: new Date("2026-11-10T00:00:00Z") });

  it("edits my own entry: portions scale the macros", async () => {
    db([]);
    logs.push(mineRow());
    const res = await patchEntry(req("PATCH", { id: "clogmine000000000000000001", portions: 1.5 }));
    expect(await res.json()).toEqual({ ok: true, changed: true });
    expect(logs[0]).toMatchObject({ portions: 1.5, kcal: 900, label: "Bolognese × 1.5", planKey: "2026-11-09:1:lunch" });
  });

  it("someone else's entry answers 404 and stays untouched", async () => {
    db([]);
    logs.push(mineRow());
    h.user = SAM;
    expect((await patchEntry(req("PATCH", { id: "clogmine000000000000000001", portions: 3 }))).status).toBe(404);
    expect(logs[0].portions).toBe(1);
  });

  it("validates the body (zod): empty patch, bad meal, bad id, bad date, too many portions", async () => {
    db([]);
    for (const b of [{ id: "clogmine000000000000000001" }, { id: "clogmine000000000000000001", meal: "brunch" }, { id: "x", portions: 1 }, { id: "clogmine000000000000000001", date: "2026-13-01" }, { id: "clogmine000000000000000001", portions: 9 }])
      expect((await patchEntry(req("PATCH", b))).status).toBe(400);
  });
});
