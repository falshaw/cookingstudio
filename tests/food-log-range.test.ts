// Food log week / month / 3 mo / 6 mo / year views: pure aggregation helpers + the owner-scoped
// GET /api/food-log/summary route (per-day totals only, ≤ 366 days, never another user's rows).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";
import type { DayTotal } from "@/lib/food-log";
import {
  bucketDays,
  daysBetween,
  fillDays,
  groupsToDays,
  monthDays,
  monthGrid,
  parseView,
  periodRange,
  shiftMonth,
  shiftPeriod,
  summarise,
  targetStatus,
  tone,
  weekDays,
} from "@/lib/food-log-range";
import { keyHash, newRawKey } from "@/lib/api-keys";

const h = vi.hoisted(() => ({ overrides: {} as Overrides, session: null as null | { id: string; slug: string; name: string; email: string } }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return makePrisma(h.overrides).client;
  },
}));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => h.session) }));
const summary = await import("@/app/api/food-log/summary/route");

const day = (date: string, kcal: number, entries = 1, o: Partial<DayTotal> = {}): DayTotal => ({ date, kcal, protein: kcal / 20, netCarbs: kcal / 25, fat: kcal / 30, entries, ...o });

describe("calendar ranges", () => {
  it("week = Mon–Sun containing the day (also across a month/year edge)", () => {
    expect(weekDays("2026-11-17")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(weekDays("2026-11-22")[0]).toBe("2026-11-16"); // Sunday belongs to the week before
    expect(weekDays("2027-01-01")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  });
  it("month days + Mon-first grid with empty cells", () => {
    expect(monthDays("2026-02-10")).toHaveLength(28);
    expect(monthDays("2028-02-10")).toHaveLength(29);
    const g = monthGrid("2026-11-17"); // 1 Nov 2026 = Sunday
    expect(g[0]).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(g.every((r) => r.length === 7)).toBe(true);
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    expect(g[g.length - 1][0]).toBe("2026-11-30");
  });
  it("shiftMonth goes to the 1st, never rolls 31 Jan into March", () => {
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftMonth("2026-01-15", -1)).toBe("2025-12-01");
  });
  it("long periods end with the month of the day; ‹ › move by the whole period; a year fits 366 days", () => {
    expect(periodRange("3m", "2026-11-17")).toEqual({ from: "2026-09-01", to: "2026-11-30" });
    expect(periodRange("6m", "2026-11-17")).toEqual({ from: "2026-06-01", to: "2026-11-30" });
    expect(periodRange("1y", "2026-11-17")).toEqual({ from: "2025-12-01", to: "2026-11-30" });
    expect(periodRange("1y", "2028-12-05")).toEqual({ from: "2028-01-01", to: "2028-12-31" });
    expect(daysBetween("2028-01-01", "2028-12-31")).toHaveLength(366);
    expect(shiftPeriod("3m", "2026-11-17", -1)).toBe("2026-08-01");
    expect(shiftPeriod("1y", "2026-11-17", 1)).toBe("2027-11-01");
  });
  it("parseView falls back to day", () => {
    expect(parseView("week")).toBe("week");
    expect(parseView("1y")).toBe("1y");
    expect(parseView("decade")).toBe("day");
    expect(parseView(undefined)).toBe("day");
  });
});

describe("grouping + averages", () => {
  it("fillDays keeps the order asked for and gives empty days zeros", () => {
    const f = fillDays(["2026-11-16", "2026-11-17", "2026-11-18"], [day("2026-11-17", 1800, 3)]);
    expect(f.map((d) => [d.date, d.kcal, d.entries])).toEqual([["2026-11-16", 0, 0], ["2026-11-17", 1800, 3], ["2026-11-18", 0, 0]]);
  });
  it("average is over LOGGED days only, total over all", () => {
    const s = summarise(fillDays(weekDays("2026-11-17"), [day("2026-11-16", 2000, 4), day("2026-11-17", 1600, 2)]));
    expect(s.logged).toBe(2);
    expect(s.of).toBe(7);
    expect(s.total.kcal).toBe(3600);
    expect(s.total.entries).toBe(6);
    expect(s.avg?.kcal).toBe(1800);
    expect(s.avg?.protein).toBe(90);
  });
  it("nothing logged → avg null, not zero", () => {
    expect(summarise(fillDays(weekDays("2026-11-17"), [])).avg).toBeNull();
  });
  it("groupBy rows → day totals (null sums = 0), sorted", () => {
    const g = groupsToDays([
      { date: new Date("2026-11-17T00:00:00Z"), _sum: { kcal: 1800, protein: 110, netCarbs: 80, fat: 70 }, _count: { _all: 3 } },
      { date: new Date("2026-11-15T00:00:00Z"), _sum: { kcal: null, protein: null, netCarbs: null, fat: null }, _count: { _all: 1 } },
    ]);
    expect(g).toEqual([
      { date: "2026-11-15", kcal: 0, protein: 0, netCarbs: 0, fat: 0, entries: 1 },
      { date: "2026-11-17", kcal: 1800, protein: 110, netCarbs: 80, fat: 70, entries: 3 },
    ]);
  });
  it("weekly buckets: Mon-start, clipped to the range, avg over logged days of that week", () => {
    const { from, to } = periodRange("3m", "2026-11-17"); // 1 Sep (Tue) … 30 Nov (Mon)
    const b = bucketDays(fillDays(daysBetween(from, to), [day("2026-09-01", 2000), day("2026-09-02", 1000), day("2026-11-30", 2400)]), "week");
    expect(b[0]).toMatchObject({ key: "2026-08-31", from: "2026-09-01", to: "2026-09-06", of: 6, logged: 2 });
    expect(b[0].avg?.kcal).toBe(1500);
    expect(b[1]).toMatchObject({ key: "2026-09-07", of: 7, logged: 0, avg: null });
    expect(b[b.length - 1]).toMatchObject({ key: "2026-11-30", from: "2026-11-30", to: "2026-11-30", of: 1, logged: 1 });
    expect(b.reduce((n, x) => n + x.of, 0)).toBe(91);
  });
  it("monthly buckets: one per calendar month, days logged of days in month", () => {
    const { from, to } = periodRange("6m", "2026-11-17");
    const b = bucketDays(fillDays(daysBetween(from, to), [day("2026-06-10", 1900), day("2026-06-11", 2100), day("2026-06-12", 0, 0), day("2026-11-01", 2500, 5)]), "month");
    expect(b.map((x) => x.key)).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
    expect(b[0]).toMatchObject({ of: 30, logged: 2 });
    expect(b[0].avg?.kcal).toBe(2000);
    expect(b[1].avg).toBeNull();
    expect(b[5]).toMatchObject({ of: 30, logged: 1 });
    expect(b[5].avg?.kcal).toBe(2500);
  });
});

describe("target status", () => {
  it("±10 % band, null without a target", () => {
    expect(targetStatus(2000, 2000)).toBe("on");
    expect(targetStatus(1800, 2000)).toBe("on");
    expect(targetStatus(1799, 2000)).toBe("under");
    expect(targetStatus(2201, 2000)).toBe("over");
    expect(targetStatus(2000, null)).toBeNull();
    expect(targetStatus(2000, 0)).toBeNull();
  });
  it("tone: protein over is fine, net carbs under is fine, kcal wants the band", () => {
    expect(tone("protein", "over")).toBe("good");
    expect(tone("protein", "under")).toBe("low");
    expect(tone("netCarbs", "under")).toBe("good");
    expect(tone("netCarbs", "over")).toBe("high");
    expect(tone("kcal", "under")).toBe("low");
    expect(tone("kcal", "over")).toBe("high");
    expect(tone("kcal", "on")).toBe("good");
  });
});

describe("GET /api/food-log/summary", () => {
  const ALEX = { id: "calex00000000000000000000001", slug: "alex", name: "Alex", email: "alex@kitchen.local" };
  const SAM = { id: "csam000000000000000000001", slug: "sam", name: "Sam", email: "sam@kitchen.local" };
  const RAW = newRawKey();
  // both users' rows in one table; the fake groupBy honours the WHERE like Postgres would
  const rows = [
    { userId: ALEX.id, date: "2026-11-16", kcal: 2000, protein: 120, netCarbs: 90, fat: 80 },
    { userId: ALEX.id, date: "2026-11-16", kcal: 300, protein: 20, netCarbs: 10, fat: 10 },
    { userId: SAM.id, date: "2026-11-16", kcal: 1500, protein: 70, netCarbs: 120, fat: 50 },
    { userId: SAM.id, date: "2026-11-17", kcal: 900, protein: 40, netCarbs: 60, fat: 30 },
  ];
  type Where = { userId: string; date: { gte: Date; lte: Date } };
  const seen: { where?: Where; by?: unknown } = {};
  const foodLog = {
    groupBy: async (a: { by: unknown; where: Where }) => {
      seen.where = a.where;
      seen.by = a.by;
      const mine = rows.filter((r) => r.userId === a.where.userId && new Date(`${r.date}T00:00:00Z`) >= a.where.date.gte && new Date(`${r.date}T00:00:00Z`) <= a.where.date.lte);
      const by = new Map<string, { date: Date; _sum: { kcal: number; protein: number; netCarbs: number; fat: number }; _count: { _all: number } }>();
      for (const r of mine) {
        const g = by.get(r.date) ?? { date: new Date(`${r.date}T00:00:00Z`), _sum: { kcal: 0, protein: 0, netCarbs: 0, fat: 0 }, _count: { _all: 0 } };
        g._sum.kcal += r.kcal;
        g._sum.protein += r.protein;
        g._sum.netCarbs += r.netCarbs;
        g._sum.fat += r.fat;
        g._count._all++;
        by.set(r.date, g);
      }
      return [...by.values()];
    },
  };
  const get = (q: string, headers: Record<string, string> = {}) => summary.GET(new Request(`http://127.0.0.1:3030/api/food-log/summary?${q}`, { headers }));
  const keyStore = (scopes: string[]) => ({
    findUnique: async (a: { where: { keyHash: string } }) => (a.where.keyHash === keyHash(RAW) ? { id: "ckey0000000000000000000001", scopes, expiresAt: new Date(Date.now() + 86_400_000), lastUsedAt: new Date(), user: SAM } : null),
    updateMany: async () => ({ count: 1 }),
  });

  beforeEach(() => {
    h.overrides = { foodLog };
    h.session = null;
    delete seen.where;
  });

  it("401 without a session or key, and the database is not touched", async () => {
    const res = await get("from=2026-11-01&to=2026-11-30");
    expect(res.status).toBe(401);
    expect(seen.where).toBeUndefined();
  });
  it("session: only MY per-day totals, grouped by date", async () => {
    h.session = ALEX;
    const res = await get("from=2026-11-01&to=2026-11-30");
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(seen.where?.userId).toBe(ALEX.id);
    expect(seen.by).toEqual(["date"]);
    expect(j.days).toEqual([{ date: "2026-11-16", kcal: 2300, protein: 140, netCarbs: 100, fat: 90, entries: 2 }]);
    expect(JSON.stringify(j)).not.toContain(SAM.id);
    expect(j.entries).toBeUndefined(); // totals only, no entry rows
  });
  it("API key acts as its owner (Sam), even with Alex's session cookie around", async () => {
    h.session = ALEX;
    h.overrides = { foodLog, apiKey: keyStore(["food-log:read"]) };
    const j = await (await get("from=2026-11-01&to=2026-11-30", { authorization: `Bearer ${RAW}` })).json();
    expect(seen.where?.userId).toBe(SAM.id);
    expect(j.days.map((d: DayTotal) => [d.date, d.kcal])).toEqual([["2026-11-16", 1500], ["2026-11-17", 900]]);
  });
  it("a key without a food-log scope gets 403", async () => {
    h.overrides = { foodLog, apiKey: keyStore(["weight:read"]) };
    expect((await get("from=2026-11-01&to=2026-11-30", { authorization: `Bearer ${RAW}` })).status).toBe(403);
  });
  it("bounded: ≤ 366 days, real dates, to ≥ from", async () => {
    h.session = ALEX;
    expect((await get("from=2028-01-01&to=2028-12-31")).status).toBe(200); // leap year = 366 days
    expect((await get("from=2026-01-01&to=2027-01-02")).status).toBe(400); // 367 days
    expect((await get("from=2026-02-31&to=2026-03-01")).status).toBe(400);
    expect((await get("from=2026-11-30&to=2026-11-01")).status).toBe(400);
    expect((await get("")).status).toBe(400);
  });
});
