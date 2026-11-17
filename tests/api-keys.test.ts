// API keys for scripts and assistants: a key acts as its owner, only on routes that name one of its
// scopes; session-only routes refuse it; only sha256(key) is stored; the proxy strips a key request's cookie.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";

const h = vi.hoisted(() => ({ overrides: {} as Overrides, session: null as null | { id: string; slug: string; name: string; email: string } }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return makePrisma(h.overrides).client;
  },
}));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => h.session) }));

const { userForKey, keyHash, newRawKey, keyHint, bearerOf } = await import("@/lib/api-keys");
const foodLog = await import("@/app/api/food-log/route");
const keys = await import("@/app/api/keys/route");
const weight = await import("@/app/api/weight/route");
const shoppingAdd = await import("@/app/api/shopping/add/route");
const { proxy } = await import("@/proxy");

const ALEX = { id: "calex00000000000000000000001", slug: "alex", name: "Alex", email: "alex@kitchen.local" };
const SAM = { id: "csam000000000000000000001", slug: "sam", name: "Sam", email: "sam@kitchen.local" };
const RAW = newRawKey();
const future = () => new Date(Date.now() + 86_400_000);

type KeyRow = { id: string; scopes: string[]; expiresAt: Date; lastUsedAt: Date | null; user: typeof ALEX };
function keyStore(row: Partial<KeyRow> | null, seen: { where?: unknown; touched?: number } = {}) {
  return {
    findUnique: async (a: { where: { keyHash: string } }) => {
      seen.where = a.where;
      if (!row || a.where.keyHash !== keyHash(RAW)) return null;
      return { id: "ckey0000000000000000000001", scopes: [], expiresAt: future(), lastUsedAt: null, user: SAM, ...row };
    },
    updateMany: async () => ((seen.touched = (seen.touched ?? 0) + 1), { count: 1 }),
  };
}

const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://127.0.0.1:3030${path}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const bearer = (raw = RAW) => ({ authorization: `Bearer ${raw}` });

beforeEach(() => {
  h.overrides = {};
  h.session = null;
});

describe("key format + hashing", () => {
  it("kit_ + 43 url-safe chars, a fresh key each time, hint never reveals the key", () => {
    const a = newRawKey();
    expect(a).toMatch(/^kit_[A-Za-z0-9_-]{43}$/);
    expect(newRawKey()).not.toBe(a);
    expect(keyHint(a)).toBe(`${a.slice(0, 8)}…`);
    expect(keyHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(keyHash(a)).not.toContain(a.slice(4, 20));
  });
  it("bearerOf takes only the exact `Bearer <token>` form", () => {
    expect(bearerOf(call("GET", "/x", undefined, bearer()))).toBe(RAW);
    expect(bearerOf(call("GET", "/x", undefined, { authorization: `bearer ${RAW}` }))).toBeNull();
    expect(bearerOf(call("GET", "/x", undefined, { authorization: `Basic abc` }))).toBeNull();
    expect(bearerOf(call("GET", "/x"))).toBeNull();
  });
});

describe("userForKey", () => {
  it("a malformed key never reaches the database", async () => {
    const seen: { where?: unknown } = {};
    h.overrides = { apiKey: keyStore({ scopes: ["food-log:read"] }, seen) };
    expect(await userForKey("kit_short", ["food-log:read"])).toMatchObject({ status: 401 });
    expect(seen.where).toBeUndefined();
  });
  it("looks the key up by its hash, never the key itself", async () => {
    const seen: { where?: unknown } = {};
    h.overrides = { apiKey: keyStore({ scopes: ["food-log:read"] }, seen) };
    const r = await userForKey(RAW, ["food-log:read"]);
    expect(r.user).toEqual(SAM);
    expect(seen.where).toEqual({ keyHash: keyHash(RAW) });
  });
  it("unknown and expired keys are both a plain 401", async () => {
    h.overrides = { apiKey: keyStore(null) };
    expect(await userForKey(RAW, ["food-log:read"])).toEqual({ error: "Invalid or expired API key", status: 401 });
    h.overrides = { apiKey: keyStore({ scopes: ["food-log:read"], expiresAt: new Date(Date.now() - 1000) }) };
    expect(await userForKey(RAW, ["food-log:read"])).toEqual({ error: "Invalid or expired API key", status: 401 });
  });
  it("a live key without the scope is 403", async () => {
    h.overrides = { apiKey: keyStore({ scopes: ["weight:write"] }) };
    expect(await userForKey(RAW, ["food-log:read", "food-log:write"])).toMatchObject({ status: 403 });
  });
  it("lastUsedAt is written at most once a minute", async () => {
    const seen: { touched?: number } = {};
    h.overrides = { apiKey: keyStore({ scopes: ["food-log:read"], lastUsedAt: new Date() }, seen) };
    await userForKey(RAW, ["food-log:read"]);
    expect(seen.touched).toBeUndefined();
    h.overrides = { apiKey: keyStore({ scopes: ["food-log:read"], lastUsedAt: new Date(Date.now() - 120_000) }, seen) };
    await userForKey(RAW, ["food-log:read"]);
    expect(seen.touched).toBe(1);
  });
});

describe("scoped routes act as the key's owner", () => {
  it("POST /api/food-log estimate is written for the key owner, never the session user", async () => {
    h.session = ALEX; // ignored: a key request is judged by the key alone
    const created: Record<string, unknown>[] = [];
    h.overrides = { apiKey: keyStore({ scopes: ["food-log:write"] }), foodLog: { create: async (a: { data: Record<string, unknown> }) => (created.push(a.data), a.data) } };
    const res = await foodLog.POST(call("POST", "/api/food-log", { date: "2026-11-11", meal: "dinner", label: "Veg lasagne ~300 g (estimate)", kcal: 520, protein: 24, netCarbs: 50, fat: 22 }, bearer()));
    expect(res.status).toBe(200);
    expect(created[0]).toMatchObject({ userId: SAM.id, meal: "dinner", label: "Veg lasagne ~300 g (estimate)", kcal: 520, protein: 24, netCarbs: 50, fat: 22, recipeId: null, portions: 1 });
  });
  it("an estimate needs all five fields", async () => {
    h.session = ALEX;
    const res = await foodLog.POST(call("POST", "/api/food-log", { date: "2026-11-11", meal: "dinner", label: "Soup", kcal: 300 }));
    expect(res.status).toBe(400);
  });
  it("a read-only key cannot write", async () => {
    h.overrides = { apiKey: keyStore({ scopes: ["food-log:read"] }) };
    const res = await foodLog.POST(call("POST", "/api/food-log", { date: "2026-11-11", meal: "dinner", label: "x", kcal: 1, protein: 1, netCarbs: 1, fat: 1 }, bearer()));
    expect(res.status).toBe(403);
  });
  it("DELETE only ever touches the owner's rows", async () => {
    let where: unknown;
    h.overrides = { apiKey: keyStore({ scopes: ["food-log:write"] }), foodLog: { deleteMany: async (a: { where: unknown }) => ((where = a.where), { count: 1 }) } };
    await foodLog.DELETE(call("DELETE", "/api/food-log", { id: "cfood000000000000000000001" }, bearer()));
    expect(where).toEqual({ id: "cfood000000000000000000001", userId: SAM.id });
  });
  it("GET /api/food-log returns my entries + day totals, bounded range", async () => {
    let where: { userId?: string } = {};
    const d = new Date("2026-11-11T00:00:00Z");
    h.overrides = {
      apiKey: keyStore({ scopes: ["food-log:read"] }),
      foodLog: {
        findMany: async (a: { where: typeof where }) => (
          (where = a.where),
          [
            { id: "c1", date: d, meal: "dinner", label: "Veg lasagne", portions: 1, kcal: 520, protein: 24, netCarbs: 50, fat: 22 },
            { id: "c2", date: d, meal: "dinner", label: "Fruit yogurt", portions: 1, kcal: 180, protein: 8, netCarbs: 25, fat: 5 },
          ]
        ),
      },
    };
    const res = await foodLog.GET(call("GET", "/api/food-log?from=2026-11-11&to=2026-11-11", undefined, bearer()));
    const j = await res.json();
    expect(where.userId).toBe(SAM.id);
    expect(j.days).toEqual([{ date: "2026-11-11", kcal: 700, protein: 32, netCarbs: 75, fat: 27, entries: 2 }]);
    expect(j.entries[0].date).toBe("2026-11-11");
    expect((await foodLog.GET(call("GET", "/api/food-log?from=2026-01-01&to=2026-12-31", undefined, bearer()))).status).toBe(400);
    expect((await foodLog.GET(call("GET", "/api/food-log?from=2026-02-31", undefined, bearer()))).status).toBe(400);
  });
  it("weight: write key logs for its owner; a food-log key gets 403", async () => {
    let created: { userId?: string } = {};
    h.overrides = { apiKey: keyStore({ scopes: ["weight:write"] }), weightEntry: { upsert: async (a: { create: typeof created }) => ((created = a.create), a.create) } };
    expect((await weight.POST(call("POST", "/api/weight", { date: "2026-11-12", kg: 64 }, bearer()))).status).toBe(200);
    expect(created.userId).toBe(SAM.id);
    h.overrides = { apiKey: keyStore({ scopes: ["food-log:write"] }) };
    expect((await weight.POST(call("POST", "/api/weight", { date: "2026-11-12", kg: 64 }, bearer()))).status).toBe(403);
  });
  it("shopping by name: known ingredient = one pack, unknown = free-text line in Other", async () => {
    const created: Record<string, unknown>[] = [];
    h.overrides = {
      apiKey: keyStore({ scopes: ["shopping:write"] }),
      ingredient: { findFirst: async () => null },
      shoppingList: { findFirst: async () => ({ id: "clist0000000000000000000001" }) },
      shoppingItem: { create: async (a: { data: Record<string, unknown> }) => (created.push(a.data), a.data) },
    };
    const res = await shoppingAdd.POST(call("POST", "/api/shopping/add", { name: "Kitchen roll" }, bearer()));
    expect(await res.json()).toMatchObject({ ok: true, name: "Kitchen roll", freeText: true, already: false });
    expect(created[0]).toMatchObject({ ingredientId: null, name: "Kitchen roll", section: "other" });
  });
});

describe("session-only routes refuse keys", () => {
  it("a key cannot make, list-by-request or delete keys", async () => {
    h.overrides = { apiKey: keyStore({ scopes: ["food-log:read", "food-log:write", "weight:read", "weight:write", "shopping:write"] }) };
    expect((await keys.POST(call("POST", "/api/keys", { name: "x", scopes: ["food-log:read"] }, bearer()))).status).toBe(403);
    expect((await keys.DELETE(call("DELETE", "/api/keys", { id: "ckey0000000000000000000001" }, bearer()))).status).toBe(403);
  });
  it("POST /api/keys (session) returns the key once and stores only hash + hint", async () => {
    h.session = ALEX;
    let data: Record<string, unknown> = {};
    h.overrides = { apiKey: { count: async () => 0, create: async (a: { data: Record<string, unknown> }) => ((data = a.data), { id: "ck", name: a.data.name, hint: a.data.hint, scopes: a.data.scopes, expiresAt: a.data.expiresAt }) } };
    const res = await keys.POST(call("POST", "/api/keys", { name: "My assistant", scopes: ["food-log:write", "food-log:write"], days: 30 }));
    const j = await res.json();
    expect(j.key).toMatch(/^kit_/);
    expect(data.keyHash).toBe(keyHash(j.key));
    expect(JSON.stringify(data)).not.toContain(j.key);
    expect(data.userId).toBe(ALEX.id);
    expect(data.scopes).toEqual(["food-log:write"]);
  });
  it("unknown scope or too many keys are refused", async () => {
    h.session = ALEX;
    expect((await keys.POST(call("POST", "/api/keys", { name: "x", scopes: ["labs:read"] }))).status).toBe(400);
    h.overrides = { apiKey: { count: async () => 10 } };
    expect((await keys.POST(call("POST", "/api/keys", { name: "x", scopes: ["food-log:read"] }))).status).toBe(409);
  });
  it("DELETE /api/keys only deletes my own key", async () => {
    h.session = ALEX;
    let where: unknown;
    h.overrides = { apiKey: { deleteMany: async (a: { where: unknown }) => ((where = a.where), { count: 0 }) } };
    expect((await keys.DELETE(call("DELETE", "/api/keys", { id: "ckey0000000000000000000001" }))).status).toBe(404);
    expect(where).toEqual({ id: "ckey0000000000000000000001", userId: ALEX.id });
  });
});

describe("proxy with a key", () => {
  const preq = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
    new NextRequest(new URL(path, "http://127.0.0.1:3030"), { method: init.method ?? "GET", headers: { host: "127.0.0.1:3030", ...init.headers } });
  it("a key POST without Origin passes, with its cookie stripped", async () => {
    const r = await proxy(preq("/api/food-log", { method: "POST", headers: { ...bearer(), cookie: "kitchen_session=abc" } }));
    expect(r.status).toBe(200);
    expect(r.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(r.headers.get("x-middleware-override-headers") ?? "").not.toMatch(/(^|,)cookie(,|$)/);
  });
  it("a key on a page path is not a login", async () => {
    const r = await proxy(preq("/food-log", { headers: bearer() }));
    expect(r.status).toBe(307);
  });
  it("the Host allowlist still applies to key requests", async () => {
    const r = await proxy(new NextRequest(new URL("/api/food-log", "http://evil.example"), { headers: { host: "evil.example", ...bearer() } }));
    expect(r.status).toBe(421);
  });
});
