// Health pages are private: signed in as Sam, a `?who=alex` in the URL must
// not make any page read Alex's rows. Every health-table read is recorded and must be scoped to
// Sam's id. The page functions are awaited (the reads happen on call); nothing renders to a DOM.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";

const ALEX_ID = "calex00000000000000000000001";
const SAM = { id: "csam000000000000000000001", slug: "sam", name: "Sam", email: "a@k" };
const profile = { vegetarian: true, vegBreakfastAllowed: [], avoidFoods: [], noAlcohol: false, noAddedSugar: false, noRefinedStarch: false, maxNetCarbsPerMeal: null, minProteinPerMeal: null, maxCookMinutes: null, omega3MinPerWeek: null, omega3MaxPerWeek: null, portionFactor: 1, trackedNutrients: [], nextLabDate: null, goals: "", weightLostKg: null };
const samRow = { ...SAM, profile };

const h = vi.hoisted(() => ({ db: null as null | { client: Record<string, unknown>; calls: { model: string; method: string; args: unknown }[] } }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return h.db!.client;
  },
}));
vi.mock("@/lib/auth", () => ({ currentUser: vi.fn(async () => SAM) }));
vi.mock("@/lib/ollama", () => ({ ollamaUp: vi.fn(async () => false) }));

// Tables that hold one person's health data — every read must carry where.userId = the caller.
const HEALTH_MODELS = new Set(["labResult", "labImport", "weightEntry", "glucoseReading", "foodLog", "userProfile", "job"]);

beforeEach(() => {
  const byId = async (a: { where: { id: string } }) => (a.where.id === SAM.id ? samRow : { id: a.where.id, slug: "alex", name: "Alex", profile });
  const overrides: Overrides = { user: { findUnique: byId, findUniqueOrThrow: byId } };
  h.db = makePrisma(overrides);
});

type Page = (props: unknown) => Promise<unknown>;
const props = { searchParams: Promise.resolve({ who: "alex" }), params: Promise.resolve({}) };

async function readsOf(load: () => Promise<{ default: unknown }>) {
  const page = (await load()).default as Page;
  expect(await page(props)).toBeTruthy();
  return h.db!.calls;
}

function expectOwnOnly(calls: { model: string; method: string; args: unknown }[], mustRead: string[]) {
  const health = calls.filter((c) => HEALTH_MODELS.has(c.model));
  for (const m of mustRead) expect(health.some((c) => c.model === m), `reads ${m}`).toBe(true);
  for (const c of health) expect((c.args as { where?: { userId?: string } })?.where?.userId, `${c.model}.${c.method}`).toBe(SAM.id);
  // user lookups: by Sam's id only; the one shared read (portion factors) selects nothing else
  for (const c of calls.filter((x) => x.model === "user")) {
    const a = c.args as { where?: { id?: string }; select?: unknown };
    if (c.method === "findMany") expect(a.select).toEqual({ slug: true, profile: { select: { portionFactor: true } } });
    else expect(a.where?.id, `user.${c.method}`).toBe(SAM.id);
  }
  expect(JSON.stringify(calls)).not.toContain(ALEX_ID);
}

describe("health pages read only the caller's own rows, whatever ?who= says", () => {
  it("/health", async () => {
    expectOwnOnly(await readsOf(() => import("@/app/(app)/health/page")), ["labResult", "labImport", "weightEntry"]);
  });
  it("/glucose", async () => {
    // a reading exists, so the day view (readings + food log of that day) is loaded too
    h.db = makePrisma({ glucoseReading: { findFirst: async () => ({ at: new Date("2026-10-19T08:00:00Z"), mgdl: 100 }) } });
    expectOwnOnly(await readsOf(() => import("@/app/(app)/glucose/page")), ["glucoseReading", "foodLog"]);
  });
  it("/report", async () => {
    expectOwnOnly(await readsOf(() => import("@/app/(app)/report/page")), ["weightEntry", "job"]);
  });
  it("/food-log", async () => {
    expectOwnOnly(await readsOf(() => import("@/app/(app)/food-log/page")), ["foodLog", "userProfile"]);
  });
});
