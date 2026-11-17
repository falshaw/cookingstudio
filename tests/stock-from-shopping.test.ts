// Ticked "bought" on the shopping list → stock "in"; unticking undoes only what the tick did.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";
import { addDays, appTimeZone, isRealDay, localDay } from "@/lib/utils";

const h = vi.hoisted(() => ({ overrides: {} as Overrides, calls: [] as { model: string; method: string; args: unknown }[] }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    const db = makePrisma(h.overrides);
    h.calls = db.calls;
    return db.client;
  },
}));

const { boughtState, handOver, parseUndo, revertAction, setShoppingTick, stockLocation } = await import("@/lib/stock-from-shopping");

const TODAY = "2026-10-25";

describe("boughtState: what a tick writes", () => {
  it("new stock: in, best-before = today + keepsDays", () => {
    expect(boughtState(null, 5, TODAY)).toEqual({ status: "in", bestBefore: "2026-10-30" });
  });
  it("no keepsDays → no date", () => {
    expect(boughtState(null, null, TODAY)).toEqual({ status: "in", bestBefore: null });
  });
  it("low/out row: stale date replaced (or dropped without keepsDays)", () => {
    expect(boughtState({ status: "out", bestBefore: "2026-10-01" }, 7, TODAY)).toEqual({ status: "in", bestBefore: "2026-11-01" });
    expect(boughtState({ status: "low", bestBefore: "2026-10-01" }, null, TODAY)).toEqual({ status: "in", bestBefore: null });
  });
  it("already in: the later date wins", () => {
    expect(boughtState({ status: "in", bestBefore: "2027-03-01" }, 7, TODAY).bestBefore).toBe("2027-03-01");
    expect(boughtState({ status: "in", bestBefore: "2026-10-26" }, 7, TODAY).bestBefore).toBe("2026-11-01");
    expect(boughtState({ status: "in", bestBefore: "2026-10-26" }, null, TODAY).bestBefore).toBe("2026-10-26");
  });
});

describe("revertAction / handOver: what an untick does", () => {
  const wrote = { status: "in", bestBefore: "2026-10-30" };
  it("no row before → delete; a row before → restore it", () => {
    expect(revertAction({ prev: null, wrote }, wrote)).toEqual({ kind: "delete" });
    const prev = { status: "low", bestBefore: "2026-10-20" };
    expect(revertAction({ prev, wrote }, wrote)).toEqual({ kind: "restore", state: prev });
  });
  it("stock changed since the tick (edited, marked low, removed) → leave it alone", () => {
    expect(revertAction({ prev: null, wrote }, { status: "low", bestBefore: "2026-10-30" })).toEqual({ kind: "none" });
    expect(revertAction({ prev: null, wrote }, { status: "in", bestBefore: "2026-11-05" })).toEqual({ kind: "none" });
    expect(revertAction({ prev: null, wrote }, null)).toEqual({ kind: "none" });
  });
  it("a second ticked item stacked on this one inherits its prev", () => {
    const a = { prev: null, wrote };
    const b = { id: "b", undo: { prev: wrote, wrote } };
    expect(handOver(a, [b])).toEqual({ id: "b", undo: { prev: null, wrote } });
    expect(handOver(a, [{ id: "c", undo: { prev: { status: "out", bestBefore: null }, wrote } }])).toBeNull();
  });
  it("parseUndo rejects junk", () => {
    expect(parseUndo(null)).toBeNull();
    expect(parseUndo({ prev: null })).toBeNull();
    expect(parseUndo({ prev: 3, wrote })).toBeNull();
    expect(parseUndo({ prev: null, wrote })).toEqual({ prev: null, wrote });
  });
  it("location for a new row", () => {
    expect(stockLocation({ kind: "spice", storeWhere: "pantry" })).toBe("spices");
    expect(stockLocation({ kind: "fresh", storeWhere: "fridge" })).toBe("fridge");
    expect(stockLocation({ kind: "fresh", storeWhere: "" })).toBe("pantry");
  });
});

describe("date helpers", () => {
  it("localDay is the calendar day in the given time zone", () => {
    expect(localDay(new Date("2026-10-24T12:30:00Z"), "Pacific/Auckland")).toBe("2026-10-25"); // 01:30 NZDT
    expect(localDay(new Date("2026-10-24T10:00:00Z"), "Pacific/Auckland")).toBe("2026-10-24");
    expect(localDay(new Date("2026-10-24T22:30:00Z"), "UTC")).toBe("2026-10-24");
  });
  it("appTimeZone falls back to UTC for unset or invalid zones", () => {
    expect(appTimeZone(undefined)).toBe("UTC");
    expect(appTimeZone("Not/AZone")).toBe("UTC");
    expect(appTimeZone("America/Chicago")).toBe("America/Chicago");
  });
  it("addDays crosses months; isRealDay refuses rolled-over dates", () => {
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(isRealDay("2026-02-31")).toBe(false);
    expect(isRealDay("2026-02-28")).toBe(true);
    expect(isRealDay("26-02-28")).toBe(false);
  });
});

describe("setShoppingTick (DB flow, fake Prisma)", () => {
  const ITEM = "citem0000000000000000000001";
  const ING = "cing00000000000000000000001";
  const NOW = new Date("2026-10-25T09:00:00Z");
  let item: { id: string; checked: boolean; ingredientId: string | null; stockUndo: unknown };
  let stock: { ingredientId: string; status: string; bestBefore: Date | null } | null;

  beforeEach(() => {
    item = { id: ITEM, checked: false, ingredientId: ING, stockUndo: null };
    stock = null;
    h.overrides = {
      shoppingItem: {
        findUnique: async () => item,
        updateMany: async (a: { where: { checked: boolean }; data: { checked: boolean } }) => (item.checked === a.where.checked ? ((item.checked = a.data.checked), { count: 1 }) : { count: 0 }),
        update: async (a: { data: { stockUndo: unknown } }) => ((item.stockUndo = a.data.stockUndo && typeof a.data.stockUndo === "object" && "wrote" in a.data.stockUndo ? a.data.stockUndo : null), item),
        findMany: async () => [],
      },
      stockItem: {
        findUnique: async () => stock,
        create: async (a: { data: { ingredientId: string; status: string; bestBefore: Date | null; location: string } }) => ((stock = { ...a.data }), stock),
        update: async (a: { data: { status: string; bestBefore: Date | null } }) => ((stock = { ...stock!, ...a.data }), stock),
        deleteMany: async () => ((stock = null), { count: 1 }),
      },
      ingredient: { findUnique: async () => ({ kind: "fresh", storeWhere: "fridge", keepsDays: 5 }) },
    };
  });

  it("tick creates the stock row, untick deletes it again", async () => {
    expect(await setShoppingTick(ITEM, true, NOW)).toMatchObject({ changed: true, stock: "added", bestBefore: "2026-10-30" });
    expect(stock).toMatchObject({ status: "in", location: "fridge" });
    expect(stock!.bestBefore!.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(await setShoppingTick(ITEM, false, NOW)).toMatchObject({ stock: "reverted" });
    expect(stock).toBeNull();
  });

  it("untick restores what was there before, never wipes it", async () => {
    stock = { ingredientId: ING, status: "low", bestBefore: new Date("2026-10-20T00:00:00Z") };
    await setShoppingTick(ITEM, true, NOW);
    expect(stock).toMatchObject({ status: "in" });
    await setShoppingTick(ITEM, false, NOW);
    expect(stock).toMatchObject({ status: "low", bestBefore: new Date("2026-10-20T00:00:00Z") });
  });

  it("re-sending the same tick is a no-op", async () => {
    await setShoppingTick(ITEM, true, NOW);
    const before = JSON.stringify(stock);
    expect(await setShoppingTick(ITEM, true, NOW)).toMatchObject({ changed: false, stock: "kept" });
    expect(JSON.stringify(stock)).toBe(before);
  });

  it("free-text item: tick saved, no stock write", async () => {
    item.ingredientId = null;
    expect(await setShoppingTick(ITEM, true, NOW)).toMatchObject({ changed: true, stock: null });
    expect(h.calls.some((c) => c.model === "stockItem")).toBe(false);
  });

  it("unknown item → null", async () => {
    h.overrides.shoppingItem = { findUnique: async () => null };
    expect(await setShoppingTick(ITEM, true, NOW)).toBeNull();
  });
});

describe("PATCH /api/shopping/items", () => {
  it("returns the stock hint", async () => {
    vi.doMock("@/lib/auth", () => ({ currentUser: vi.fn(async () => ({ id: "calex00000000000000000000001", slug: "alex", name: "Alex", email: "n@k" })) }));
    h.overrides = {
      shoppingItem: { findUnique: async () => ({ id: "x", checked: false, ingredientId: null, stockUndo: null }), updateMany: async () => ({ count: 1 }) },
    };
    const { PATCH } = await import("@/app/api/shopping/items/route");
    const req = (body: unknown) => new Request("http://127.0.0.1:3030/api/shopping/items", { method: "PATCH", body: JSON.stringify(body) });
    expect((await PATCH(req({ id: "nope", checked: true }))).status).toBe(400);
    const res = await PATCH(req({ id: "citem0000000000000000000001", checked: true }));
    expect(await res.json()).toEqual({ ok: true, stock: null, bestBefore: null });
    h.overrides = { shoppingItem: { findUnique: async () => null } };
    expect((await PATCH(req({ id: "citem0000000000000000000001", checked: true }))).status).toBe(404);
  });

  it("refuses a JSON body over 1 MB with 413 before it reaches zod or the DB (streamed or declared)", async () => {
    vi.doMock("@/lib/auth", () => ({ currentUser: vi.fn(async () => ({ id: "calex00000000000000000000001", slug: "alex", name: "Alex", email: "n@k" })) }));
    h.overrides = {
      shoppingItem: {
        findUnique: async () => {
          throw new Error("must not reach the DB");
        },
      },
    };
    const { PATCH } = await import("@/app/api/shopping/items/route");
    const url = "http://127.0.0.1:3030/api/shopping/items";
    // no Content-Length: counted while it streams
    const streamed = await PATCH(new Request(url, { method: "PATCH", body: JSON.stringify({ id: "citem0000000000000000000001", checked: true, pad: "x".repeat(1_000_001) }) }));
    expect(streamed.status).toBe(413);
    expect(await streamed.json()).toEqual({ error: "Request too large (max 1 MB)" });
    // declared over the cap: refused without reading
    expect((await PATCH(new Request(url, { method: "PATCH", headers: { "content-length": "2000000" }, body: "{}" }))).status).toBe(413);
    // just under the cap still parses (and fails zod on the id, not on size)
    expect((await PATCH(new Request(url, { method: "PATCH", body: JSON.stringify({ id: "nope", pad: "x".repeat(999_000) }) }))).status).toBe(400);
  });
});
