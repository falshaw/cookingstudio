// Faster food log: copy day / meal, recent foods, USDA grams — and every copy stays the caller's own.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";
import { copyRows, macrosForGrams, recentFoods, type LogRow } from "@/lib/food-log";
import { nutritionTokens } from "@/lib/nutrition-search";

const row = (o: Partial<LogRow> = {}): LogRow => ({ meal: "breakfast", label: "Egg 100 g", recipeId: null, portions: 1, kcal: 143, protein: 12.6, netCarbs: 0.7, fat: 9.5, ...o });

describe("copyRows", () => {
  it("copies every entry of the source day", () => {
    const src = [row(), row({ meal: "dinner", label: "Bolognese", recipeId: "crec", kcal: 610 })];
    const { rows, skipped } = copyRows(src, []);
    expect(rows).toEqual(src);
    expect(skipped).toBe(0);
  });
  it("one meal only", () => {
    const { rows } = copyRows([row(), row({ meal: "dinner", label: "Bolognese" })], [], "dinner");
    expect(rows.map((r) => r.label)).toEqual(["Bolognese"]);
  });
  it("skips what is already on the target day — a double tap does not double the day", () => {
    const src = [row(), row({ meal: "lunch", label: "Salad" })];
    const first = copyRows(src, []);
    const second = copyRows(src, first.rows);
    expect(second.rows).toHaveLength(0);
    expect(second.skipped).toBe(2);
  });
  it("two identical source entries both copy; one already there only covers one", () => {
    expect(copyRows([row(), row()], []).rows).toHaveLength(2);
    expect(copyRows([row(), row()], [row()])).toMatchObject({ skipped: 1, rows: [row()] });
  });
  it("same label but other meal or other kcal is a different entry", () => {
    expect(copyRows([row()], [row({ meal: "snack" })]).rows).toHaveLength(1);
    expect(copyRows([row()], [row({ kcal: 200 })]).rows).toHaveLength(1);
  });
  it("never carries ids or user fields", () => {
    const src = [{ ...row(), id: "cx", userId: "cother", date: new Date() } as LogRow];
    expect(Object.keys(copyRows(src, []).rows[0]).sort()).toEqual(["fat", "kcal", "label", "meal", "netCarbs", "portions", "protein", "recipeId"]);
  });
});

describe("recentFoods", () => {
  const e = (id: string, label: string, day: string, o: Partial<LogRow> = {}, at = "08:00") => ({ ...row({ label, ...o }), id, date: new Date(`${day}T00:00:00Z`), createdAt: new Date(`${day}T${at}:00Z`) });
  it("dedupes by label (case/space-insensitive), newest first, newest numbers win", () => {
    const r = recentFoods([
      e("c1", "Egg 100 g", "2026-10-20", { kcal: 140 }),
      e("c2", "Oats 50 g", "2026-10-23"),
      e("c3", "egg  100 g", "2026-10-24", { kcal: 143 }),
      e("c4", "Egg 100 g", "2026-10-24", { kcal: 150 }, "07:00"),
    ]);
    expect(r.map((f) => f.entryId)).toEqual(["c3", "c2"]);
    expect(r[0]).toMatchObject({ kcal: 143, uses: 3, lastDate: "2026-10-24" });
  });
  it("a different portion is a different food", () => {
    expect(recentFoods([e("c1", "Egg 100 g", "2026-10-24"), e("c2", "Egg 50 g", "2026-10-24")])).toHaveLength(2);
  });
  it("respects the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => e(`c${i}`, `Food ${i}`, "2026-10-24"));
    expect(recentFoods(many, 5)).toHaveLength(5);
  });
});

describe("macrosForGrams", () => {
  const oats = { kcal: 379, protein: 13.15, carbs: 67.7, fat: 6.52, satFat: null, fibre: 10.1, sugar: null };
  it("per-100 g × grams, net carbs = carbs − fibre, unrounded", () => {
    const m = macrosForGrams(oats, 45);
    expect(m.kcal).toBeCloseTo(170.55, 10);
    expect(m.protein).toBeCloseTo(5.9175, 10);
    expect(m.netCarbs).toBeCloseTo((67.7 - 10.1) * 0.45, 10);
    expect(m.fat).toBeCloseTo(2.934, 10);
  });
  it("100 g = the table row; missing fibre counts as 0; never negative net carbs", () => {
    expect(macrosForGrams(oats, 100).kcal).toBe(379);
    expect(macrosForGrams({ ...oats, fibre: null }, 100).netCarbs).toBeCloseTo(67.7, 10);
    expect(macrosForGrams({ ...oats, carbs: 1, fibre: 5 }, 100).netCarbs).toBe(0);
  });
  it("search tokens", () => {
    expect(nutritionTokens("Oats, rolled!")).toEqual(["oats", "rolled"]);
    expect(nutritionTokens("a 1")).toEqual([]);
  });
});

// ---- routes: copy + grams log, all scoped to the caller ----
const ME = { id: "csam000000000000000000001", slug: "sam", name: "Sam", email: "a@k" };
const h = vi.hoisted(() => ({ overrides: {} as Overrides, calls: [] as { model: string; method: string; args: unknown }[], me: null as null | typeof ME }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    const db = makePrisma(h.overrides);
    db.calls.push = (...c) => h.calls.push(...c);
    return db.client;
  },
}));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => h.me) }));

const copyRoute = await import("@/app/api/food-log/copy/route");
const logRoute = await import("@/app/api/food-log/route");
const searchRoute = await import("@/app/api/nutrition/search/route");
const post = (fn: (r: Request) => Promise<Response>, body: unknown) => fn(new Request("http://127.0.0.1:3030/x", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  h.me = ME;
  h.calls.length = 0;
  h.overrides = {};
});

describe("POST /api/food-log/copy", () => {
  it("401 without a session; 400 on bad dates and same-day copy", async () => {
    h.me = null;
    expect((await post(copyRoute.POST, { mode: "day", from: "2026-10-24", to: "2026-10-25" })).status).toBe(401);
    h.me = ME;
    expect((await post(copyRoute.POST, { mode: "day", from: "2026-02-31", to: "2026-10-25" })).status).toBe(400);
    expect((await post(copyRoute.POST, { mode: "day", from: "2026-10-25", to: "2026-10-25" })).status).toBe(400);
  });
  it("copies yesterday onto today, reading and writing only my rows", async () => {
    h.overrides = { foodLog: { findMany: async (a: { where: { date: Date } }) => (a.where.date.toISOString().startsWith("2026-10-24") ? [row(), row({ meal: "dinner", label: "Soup" })] : [row()]), createMany: async (a: { data: unknown[] }) => ({ count: a.data.length }) } };
    const res = await post(copyRoute.POST, { mode: "day", from: "2026-10-24", to: "2026-10-25" });
    expect(await res.json()).toEqual({ ok: true, copied: 1, skipped: 1 });
    const fl = h.calls.filter((c) => c.model === "foodLog");
    for (const c of fl.filter((x) => x.method === "findMany")) expect((c.args as { where: { userId: string } }).where.userId).toBe(ME.id);
    const created = (fl.find((c) => c.method === "createMany")!.args as { data: { userId: string; date: Date; label: string }[] }).data;
    expect(created).toEqual([expect.objectContaining({ userId: ME.id, label: "Soup", date: new Date("2026-10-25T00:00:00Z") })]);
  });
  it("one meal filter is passed to the query", async () => {
    h.overrides = { foodLog: { findMany: async () => [row({ meal: "lunch" })] } };
    await post(copyRoute.POST, { mode: "day", from: "2026-10-20", to: "2026-10-25", meal: "lunch" });
    expect((h.calls.find((c) => c.method === "findMany")!.args as { where: { meal: string } }).where.meal).toBe("lunch");
  });
  it("re-log one recent entry: someone else's entry id → 404", async () => {
    expect((await post(copyRoute.POST, { mode: "entry", entryId: "centry00000000000000000001", to: "2026-10-25", meal: "snack" })).status).toBe(404);
    expect((h.calls[0].args as { where: { userId: string } }).where.userId).toBe(ME.id);
    h.overrides = { foodLog: { findFirst: async () => row() } };
    const res = await post(copyRoute.POST, { mode: "entry", entryId: "centry00000000000000000001", to: "2026-10-25", meal: "snack" });
    expect(res.status).toBe(200);
    expect((h.calls.find((c) => c.method === "create")!.args as { data: unknown }).data).toMatchObject({ userId: ME.id, meal: "snack", label: "Egg 100 g" });
  });
});

describe("POST /api/food-log by USDA grams", () => {
  it("stores per-100 g × grams unrounded under my user id", async () => {
    h.overrides = { nutritionRef: { findUnique: async () => ({ fdcId: 173904, name: "Cereals, oats, rolled", kcal: 379, protein: 13.15, carbs: 67.7, fat: 6.52, satFat: null, fibre: 10.1, sugar: null }) } };
    const res = await post(logRoute.POST, { date: "2026-10-25", meal: "breakfast", fdcId: 173904, grams: 45 });
    expect(res.status).toBe(200);
    const data = (h.calls.find((c) => c.method === "create")!.args as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ userId: ME.id, label: "Cereals, oats, rolled 45 g", recipeId: null });
    expect(data.kcal).toBeCloseTo(170.55, 10);
    expect(data.protein).toBeCloseTo(5.9175, 10);
  });
  it("404 for an unknown USDA row", async () => {
    expect((await post(logRoute.POST, { date: "2026-10-25", meal: "breakfast", fdcId: 1, grams: 45 })).status).toBe(404);
  });
});

describe("GET /api/nutrition/search", () => {
  const get = (q: string) => searchRoute.GET(new Request(`http://127.0.0.1:3030/api/nutrition/search?q=${encodeURIComponent(q)}`));
  it("needs a session and 2 letters; ranks the plain entry first", async () => {
    h.me = null;
    expect((await get("feta")).status).toBe(401);
    h.me = ME;
    expect((await get("f")).status).toBe(400);
    h.overrides = { nutritionRef: { findMany: async () => [
      { fdcId: 2, name: "Fast foods, feta salad with dressing and much more", kcal: 100, protein: 1, carbs: 1, fat: 1, fibre: null },
      { fdcId: 1, name: "Cheese, feta", kcal: 264, protein: 14.2, carbs: 4.1, fat: 21.3, fibre: 0 },
    ] } };
    const j = await (await get("feta")).json();
    expect(j.results.map((r: { fdcId: number }) => r.fdcId)).toEqual([1, 2]);
  });
});
