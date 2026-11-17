// Small API routes on the fake Prisma: "Add to shopping list" picks an OPEN list, and date fields
// refuse a rolled-over day instead of writing an Invalid Date (500).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";

const h = vi.hoisted(() => ({ overrides: {} as Overrides }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return makePrisma(h.overrides).client;
  },
}));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => ({ id: "calex00000000000000000000001", slug: "alex", name: "Alex", email: "n@k" })) }));

const { POST: addToList, OPEN_LIST_DAYS } = await import("@/app/api/shopping/add/route");
const { POST: postWeight } = await import("@/app/api/weight/route");
const { POST: postLab } = await import("@/app/api/labs/route");
const { POST: postStock } = await import("@/app/api/stock/route");

const post = (path: string, body: unknown) => new Request(`http://127.0.0.1:3030${path}`, { method: "POST", body: JSON.stringify(body) });
const ING = { id: "cing00000000000000000000001", nameEn: "Lentils", kind: "pantry", packQty: 500, packUnit: "g", section: "pantry", packLabel: "500 g bag" };
const LIST = "clist0000000000000000000001";

beforeEach(() => {
  h.overrides = {};
});

describe("POST /api/shopping/add", () => {
  it("puts one pack onto the newest list that is still open (≤ 7 days old, unticked items left)", async () => {
    let where: { createdAt?: { gte: Date }; items?: unknown } = {};
    let orderBy: unknown;
    const created: Record<string, unknown>[] = [];
    h.overrides = {
      ingredient: { findUnique: async () => ING },
      shoppingList: {
        findFirst: async (a: { where: typeof where; orderBy: unknown }) => ((where = a.where), (orderBy = a.orderBy), { id: LIST, name: "Week 43" }),
        create: async () => {
          throw new Error("must not create a list while an open one exists");
        },
      },
      shoppingItem: { create: async (a: { data: Record<string, unknown> }) => (created.push(a.data), { id: "x", ...a.data }) },
    };
    const res = await addToList(post("/api/shopping/add", { ingredientId: ING.id }));
    expect(await res.json()).toEqual({ ok: true, listId: LIST, already: false, name: "Lentils" });
    expect(OPEN_LIST_DAYS).toBe(7);
    expect(where.items).toEqual({ some: { checked: false } });
    expect(Date.now() - where.createdAt!.gte.getTime()).toBeGreaterThan(7 * 86_400_000 - 5_000);
    expect(Date.now() - where.createdAt!.gte.getTime()).toBeLessThan(7 * 86_400_000 + 5_000);
    expect(orderBy).toEqual({ createdAt: "desc" });
    expect(created[0]).toMatchObject({ listId: LIST, ingredientId: ING.id, name: "Lentils", qty: 500, unit: "g", packNote: "1 × 500 g bag", sort: 9999 });
  });

  it("creates an 'Extras' list when every list is ticked off or older than 7 days", async () => {
    let newList: unknown;
    h.overrides = {
      ingredient: { findUnique: async () => ING },
      shoppingList: { create: async (a: { data: unknown }) => ((newList = a.data), { id: "cextra000000000000000000001", ...(a.data as object) }) },
    };
    const res = await addToList(post("/api/shopping/add", { ingredientId: ING.id }));
    expect(newList).toEqual({ name: "Extras", source: "recipes" });
    expect(await res.json()).toEqual({ ok: true, listId: "cextra000000000000000000001", already: false, name: "Lentils" });
  });

  it("does not add the same ingredient twice; 404 on an unknown ingredient", async () => {
    h.overrides = {
      ingredient: { findUnique: async () => ING },
      shoppingList: { findFirst: async () => ({ id: LIST }) },
      shoppingItem: {
        findFirst: async () => ({ id: "already" }),
        create: async () => {
          throw new Error("must not duplicate");
        },
      },
    };
    expect(await (await addToList(post("/api/shopping/add", { ingredientId: ING.id }))).json()).toEqual({ ok: true, listId: LIST, already: true, name: "Lentils" });
    h.overrides = {};
    expect((await addToList(post("/api/shopping/add", { ingredientId: ING.id }))).status).toBe(404);
  });
});

describe("date fields refuse rolled-over days", () => {
  it("weight: 2026-02-31 → 400, 2026-02-28 → saved", async () => {
    const bad = await postWeight(post("/api/weight", { date: "2026-02-31", kg: 80 }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/not a real date/);
    expect((await postWeight(post("/api/weight", { date: "2026-02-28", kg: 80 }))).status).toBe(200);
  });
  it("labs and stock: same rule, null still allowed where the field is nullable", async () => {
    expect((await postLab(post("/api/labs", { marker: "HbA1c", value: 5.2, date: "2026-04-31" }))).status).toBe(400);
    expect((await postLab(post("/api/labs", { marker: "HbA1c", value: 5.2, date: null }))).status).toBe(200);
    h.overrides = { ingredient: { findUnique: async () => ING } };
    expect((await postStock(post("/api/stock", { ingredientId: ING.id, bestBefore: "2026-11-31" }))).status).toBe(400);
    expect((await postStock(post("/api/stock", { ingredientId: ING.id, bestBefore: "2026-11-30" }))).status).toBe(200);
  });
});
