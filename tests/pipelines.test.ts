// End-to-end pipeline tests with a FAKE Ollama server (real ollama.ts streaming client) and an
// in-memory Prisma stand-in. Covers teach-me, URL import, weekly feed, lab PDF, guide cards,
// weekly report and plan generation — including rule-check reject + regenerate.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";
import { startFakeOllama, type FakeOllama } from "./helpers/fake-ollama";

const h = vi.hoisted(() => ({ overrides: {} as Overrides, saved: [] as unknown[] }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return makePrisma(h.overrides).client;
  },
}));
vi.mock("@/lib/recipe-save", async (orig) => {
  const real = await orig<typeof import("@/lib/recipe-save")>();
  return { ...real, saveRecipe: vi.fn(async (_db: unknown, d: unknown, o: { slug: string }) => (h.saved.push({ d, o }), { id: "crecipe000000000000000000001", newIngredients: [] })) };
});
vi.mock("@/lib/fetch-page", () => ({ fetchRecipePage: vi.fn(async () => "Grandma's chicken souvlaki recipe: chicken, lemon, oregano. ".repeat(10)) }));

const alexProfile = { vegetarian: false, vegBreakfastAllowed: [], avoidFoods: ["olives", "celery", "milk"], noAlcohol: true, noAddedSugar: true, noRefinedStarch: true, maxNetCarbsPerMeal: 50, minProteinPerMeal: 22, maxCookMinutes: 40, omega3MinPerWeek: 1, omega3MaxPerWeek: 2, portionFactor: 1, likedFoods: ["Thai"], trackedNutrients: [], tasteOverrides: null, nextLabDate: null };
const samProfile = { ...alexProfile, vegetarian: true, vegBreakfastAllowed: ["bacon"], avoidFoods: [], noAlcohol: false, noAddedSugar: false, noRefinedStarch: false, maxNetCarbsPerMeal: null, minProteinPerMeal: null, maxCookMinutes: null, omega3MinPerWeek: null, omega3MaxPerWeek: null, likedFoods: [] };
const users = [
  { id: "calex00000000000000000000001", slug: "alex", name: "Alex", profile: alexProfile },
  { id: "csam000000000000000000001", slug: "sam", name: "Sam", profile: samProfile },
];

const draft = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    title: "Chicken souvlaki",
        servings: 2,
    prepMinutes: 15,
    cookMinutes: 12,
    ingredients: [
      { name: "Chicken thighs", grams: 400, qty: 400, unit: "g", prep: "cubed", component: "both" },
      { name: "Lemon", grams: 40, qty: 1, unit: "pc", prep: "juiced", component: "both" },
    ],
    sauceLesson: "s1-pan-juices-cream",
    steps: [
      { text: "Thread the chicken onto skewers and grill 10 minutes.", why: "High heat browns.", cue: "Golden, 74 °C", mistake: "Crowding", who: "alex", minutes: 12, technique: "sear", timerSeconds: 600, imagePrompt: "chicken skewers on a grill" },
      { text: "Make the sauce: scrape the brown bits from the tray, squeeze in the lemon and a splash of water and bubble 2 minutes until it coats the spoon.", why: "The brown bits are the flavour.", cue: "Glossy, coats a spoon", mistake: "Leaving the juices in the tray", who: "alex", minutes: 3, technique: "deglaze", timerSeconds: 120, imagePrompt: "spoon scraping a tray" },
    ],
    ...over,
  });

/** Sauce School lessons a dish may link to; any other recipe.findMany answers `other`. */
const LESSONS = [{ slug: "s1-pan-juices-cream", title: "Pan juices & cream" }, { slug: "s1-lemon-butter", title: "Lemon butter" }];
const lessonsOr = (other: unknown) => async (a?: { where?: { sauceFamily?: unknown } }) => (a?.where?.sauceFamily ? LESSONS : other);

let ollama: FakeOllama;
let worker: typeof import("@/lib/worker");

beforeAll(async () => {
  ollama = await startFakeOllama();
  process.env.OLLAMA_URL = ollama.url;
  worker = await import("@/lib/worker");
});
afterAll(() => ollama.close());
beforeEach(() => {
  ollama.queue.length = 0;
  ollama.requests.length = 0;
  h.saved.length = 0;
  h.overrides = { user: { findMany: async () => users, findUnique: async () => users[0], findUniqueOrThrow: async () => users[0] }, recipe: { findMany: lessonsOr([]) } };
});

const job = (type: string, input: Record<string, unknown>) => ({ id: "cjob00000000000000000000001", type, userId: users[0].id, input });

describe("teach-me pipeline", () => {
  it("saves a valid recipe on the first answer", async () => {
    ollama.queue.push(draft());
    const r = (await worker.runJob(job("teach", { dish: "chicken souvlaki" }))) as { slug: string };
    expect(r.slug).toMatch(/^chicken-souvlaki-/);
    expect(h.saved).toHaveLength(1);
    expect(ollama.requests[0].path).toBe("/api/generate");
    expect(ollama.requests[0].body.model).toBe("gemma4:12b");
    expect(ollama.requests[0].body.format).toBeTypeOf("object");
  });

  it("rejects a recipe that breaks a household rule (wine) and regenerates", async () => {
    const withWine = JSON.parse(draft());
    withWine.ingredients.push({ name: "Dry red wine", grams: 100, qty: 100, unit: "ml", prep: "", component: "both" });
    ollama.queue.push(JSON.stringify(withWine), draft());
    await worker.runJob(job("teach", { dish: "chicken souvlaki" }));
    expect(ollama.requests).toHaveLength(2);
    expect(String(ollama.requests[1].body.prompt)).toContain("REJECTED");
    expect(String(ollama.requests[1].body.prompt)).toContain("alcohol");
  });

  it("rejects malformed JSON and fails after 3 attempts with a readable error", async () => {
    ollama.queue.push("not json", "{\"title\": 5}", "still nothing");
    await expect(worker.runJob(job("teach", { dish: "x" }))).rejects.toThrow(/failed validation 3×/);
    expect(h.saved).toHaveLength(0);
  });

  it("never sends lab values: the recipe prompt carries only food rules", async () => {
    ollama.queue.push(draft());
    await worker.runJob(job("teach", { dish: "souvlaki" }));
    const prompt = String(ollama.requests[0].body.prompt);
    expect(prompt).toContain("never use");
    expect(prompt).not.toMatch(/HbA1c|triglycer|\bALT\b|GGT|mmol/i);
  });

  it("turns an Ollama error into a job failure", async () => {
    ollama.queue.push({ error: "model not loaded" });
    await expect(worker.runJob(job("teach", { dish: "x" }))).rejects.toThrow(/model not loaded/);
  });
});

describe("sauce rule on teach-me (checked in code)", () => {
  const noSauce = () => { const d = JSON.parse(draft()); d.steps = d.steps.slice(0, 1); return JSON.stringify(d); };
  it("asks for the sauce step + lesson in the prompt and saves the lesson link", async () => {
    ollama.queue.push(draft());
    await worker.runJob(job("teach", { dish: "chicken souvlaki" }));
    const prompt = String(ollama.requests[0].body.prompt);
    expect(prompt).toContain("make the sauce");
    expect(prompt).toContain("s1-pan-juices-cream (Pan juices & cream)");
    expect((h.saved[0] as { o: { sauceLesson: string } }).o.sauceLesson).toBe("s1-pan-juices-cream");
  });
  it("rejects a recipe that ends without a sauce step and regenerates with the reason", async () => {
    ollama.queue.push(noSauce(), draft());
    await worker.runJob(job("teach", { dish: "chicken souvlaki" }));
    expect(ollama.requests).toHaveLength(2);
    expect(String(ollama.requests[1].body.prompt)).toMatch(/REJECTED: no "make the sauce" step/);
    expect(h.saved).toHaveLength(1);
  });
  it("rejects a sauceLesson that is not a Sauce School lesson", async () => {
    ollama.queue.push(draft({ sauceLesson: "maggi-fix" }), draft());
    await worker.runJob(job("teach", { dish: "chicken souvlaki" }));
    expect(String(ollama.requests[1].body.prompt)).toContain('sauceLesson "maggi-fix" is not a Sauce School lesson');
  });
  it("gives up after the bounded 3 attempts — nothing saved", async () => {
    ollama.queue.push(noSauce(), noSauce(), noSauce());
    await expect(worker.runJob(job("teach", { dish: "x" }))).rejects.toThrow(/failed validation 3×.*sauce/);
    expect(h.saved).toHaveLength(0);
  });
});

describe("URL import pipeline", () => {
  it("parses the page into a draft for the edit preview and reports rule issues", async () => {
    const withMilk = JSON.parse(draft());
    withMilk.ingredients.push({ name: "Milk", grams: 200, qty: 200, unit: "ml", prep: "", component: "both" });
    ollama.queue.push(JSON.stringify(withMilk));
    const r = (await worker.runJob(job("import-url", { url: "https://example.com/souvlaki" }))) as { draft: { title: string }; ruleIssues: string | null };
    expect(r.draft.title).toBe("Chicken souvlaki");
    expect(r.ruleIssues).toMatch(/Milk/);
    expect(h.saved).toHaveLength(0); // nothing saved until the user confirms the preview
  });
});

describe("sauce rule on URL import (same check as teach + feed)", () => {
  const noSauce = () => { const d = JSON.parse(draft()); d.steps = d.steps.slice(0, 1); return JSON.stringify(d); };
  it("asks for the sauce step in the prompt, rejects a draft without one and regenerates", async () => {
    ollama.queue.push(noSauce(), draft());
    const r = (await worker.runJob(job("import-url", { url: "https://example.com/souvlaki" }))) as { draft: { sauceLesson: string } };
    expect(String(ollama.requests[0].body.prompt)).toContain("make the sauce");
    expect(String(ollama.requests[0].body.prompt)).toContain("PAGE TEXT:");
    expect(String(ollama.requests[1].body.prompt)).toMatch(/REJECTED: no "make the sauce" step/);
    expect(r.draft.sauceLesson).toBe("s1-pan-juices-cream");
  });
  it("rejects an unknown sauceLesson", async () => {
    ollama.queue.push(draft({ sauceLesson: "maggi-fix" }), draft());
    await worker.runJob(job("import-url", { url: "https://example.com/souvlaki" }));
    expect(String(ollama.requests[1].body.prompt)).toContain('sauceLesson "maggi-fix" is not a Sauce School lesson');
  });
  it("gives up after 3 attempts", async () => {
    ollama.queue.push(noSauce(), noSauce(), noSauce());
    await expect(worker.runJob(job("import-url", { url: "https://example.com/souvlaki" }))).rejects.toThrow(/failed validation 3×.*sauce/);
  });
  it("offers only lessons the importing user has not disliked", async () => {
    const wheres: unknown[] = [];
    h.overrides.recipe = { findMany: async (a?: { where?: { sauceFamily?: unknown } }) => { if (a?.where?.sauceFamily) wheres.push(a.where); return a?.where?.sauceFamily ? LESSONS : []; } };
    ollama.queue.push(draft());
    await worker.runJob(job("import-url", { url: "https://example.com/souvlaki" }));
    expect(wheres[0]).toMatchObject({ dislikes: { none: { userId: { in: [users[0].id] } } } });
  });
});

describe("lab PDF pipeline", () => {
  it("extracts values, flags numbers not present in the PDF text, and waits for confirmation", async () => {
    const updates: unknown[] = [];
    h.overrides.labImport = {
      findUnique: async () => ({ id: "cimport00000000000000000001", text: "HbA1c 5.5 % (4.0 - 6.0) 15.04.2026" }),
      update: async (a: unknown) => (updates.push(a), {}),
    };
    ollama.queue.push(JSON.stringify({ results: [{ marker: "HbA1c", value: 5.5, unit: "%", refLow: 4, refHigh: 6, date: "2026-04-15" }, { marker: "LDL", value: 9.9, unit: "mmol/L", refLow: null, refHigh: null, date: null }] }));
    const r = (await worker.runJob(job("lab-pdf", { importId: "cimport00000000000000000001" }))) as { count: number };
    expect(r.count).toBe(2);
    const last = updates[updates.length - 1] as { data: { status: string; extracted: { foundInText: boolean }[] } };
    expect(last.data.status).toBe("review");
    expect(last.data.extracted.map((x) => x.foundInText)).toEqual([true, false]);
  });
});

describe("guide cards", () => {
  it("writes cards for pending ingredients and maps nutrition from USDA (never the model)", async () => {
    const updated: { data: Record<string, unknown> }[] = [];
    h.overrides.ingredient = {
      findMany: async () => [{ id: "cing0000000000000000000001", nameEn: "Sumac", cardStatus: "pending" }],
      update: async (a: { data: Record<string, unknown> }) => (updated.push(a), {}),
    };
    h.overrides.nutritionRef = { findMany: async () => [{ fdcId: 999, name: "Spices, sumac, ground" }] };
    ollama.queue.push(JSON.stringify({ cards: [{ nameEn: "Sumac", section: "spices", whatItIs: "Sour red spice", buyTips: "Spice aisle", substitutes: "Lemon zest", storage: "Cupboard", usdaSearch: "sumac", isMeat: false, isFish: false, isAlcohol: false, isAddedSugar: false }] }));
    await worker.runJob(job("cards", {}));
    expect(updated[0].data.cardStatus).toBe("generated");
    expect(updated[0].data.fdcId).toBe(999);
    expect(updated[0].data.whatItIs).toBe("Sour red spice");
  });
});

describe("weekly feed pipeline", () => {
  const recipeRow = {
    id: "crecipe000000000000000000001",
    title: "Slow-cooker veg chili",
    servings: 6,
    prepMinutes: 10,
    cookMinutes: 20,
    ingredients: [
      { component: "both", grams: 600, ingredient: { slug: "courgette", nameEn: "Courgette", fdcId: 1, isMeat: false, isFish: false, isOmega3: false, isAlcohol: false, isAddedSugar: false, isRefinedStarch: false } },
      { component: "alex", grams: 180, ingredient: { slug: "chicken-thighs", nameEn: "Chicken thighs", fdcId: 2, isMeat: true, isFish: false, isOmega3: false, isAlcohol: false, isAddedSugar: false, isRefinedStarch: false } },
    ],
  };
  it("skips a duplicate title, then drafts a meal-prep recipe that passes both profiles", async () => {
    h.overrides.recipe = {
      count: async () => 0,
      findMany: async (a: { select?: Record<string, boolean>; where?: { sauceFamily?: unknown } }) => (a?.where?.sauceFamily ? LESSONS : a?.select?.title ? [{ title: "Chicken souvlaki", slug: "chicken-souvlaki" }] : []),
      findUnique: async () => recipeRow,
    };
    h.overrides.nutritionRef = { findMany: async () => [{ fdcId: 1, kcal: 17, protein: 1.2, carbs: 3.1, fat: 0.3, satFat: 0.1, fibre: 1, sugar: 2.5 }, { fdcId: 2, kcal: 120, protein: 20, carbs: 0, fat: 4, satFat: 1, fibre: 0, sugar: 0 }] };
    ollama.queue.push(draft(), draft({ title: "Slow-cooker veg chili", servings: 6 }));
    const { runFeedJob } = await import("@/lib/feed");
    const logs: string[] = [];
    const r = await runFeedJob(async (m) => void logs.push(m));
    expect(r.gap).toBe("prep"); // first feed recipe of the week is always meal prep
    expect(String(ollama.requests[1].body.prompt)).toContain("already exists");
    expect(logs.some((l) => l.includes("passes the rules"))).toBe(true);
    expect((h.saved[0] as { o: { status: string } }).o.status).toBe("draft");
  });
  it("rejects a feed recipe without sauceLesson, then saves the one that links its lesson", async () => {
    h.overrides.recipe = {
      count: async () => 0,
      findMany: async (a: { where?: { sauceFamily?: unknown } }) => (a?.where?.sauceFamily ? LESSONS : []),
      findUnique: async () => recipeRow,
    };
    h.overrides.nutritionRef = { findMany: async () => [{ fdcId: 1, kcal: 17, protein: 1.2, carbs: 3.1, fat: 0.3, satFat: 0.1, fibre: 1, sugar: 2.5 }, { fdcId: 2, kcal: 120, protein: 20, carbs: 0, fat: 4, satFat: 1, fibre: 0, sugar: 0 }] };
    ollama.queue.push(draft({ title: "Tray chicken", sauceLesson: "" }), draft({ title: "Tray chicken", sauceLesson: "s1-lemon-butter" }));
    const { runFeedJob } = await import("@/lib/feed");
    await runFeedJob(async () => {});
    expect(String(ollama.requests[0].body.prompt)).toContain("SAUCE (required)");
    expect(String(ollama.requests[1].body.prompt)).toContain("sauceLesson is missing");
    expect((h.saved[0] as { o: { sauceLesson: string | null } }).o.sauceLesson).toBe("s1-lemon-butter");
  });
});

describe("photo pipeline", () => {
  it("clears the photo from Job.input before the vision model is asked", async () => {
    const updates: { args: { where: { id: string }; data: Record<string, unknown> }; requestsSoFar: number }[] = [];
    h.overrides.job = { update: async (a: (typeof updates)[number]["args"]) => (updates.push({ args: a, requestsSoFar: ollama.requests.length }), {}) };
    h.overrides.ingredient = { findFirst: async () => ({ id: "cing0000000000000000000001", nameEn: "Chicken breast" }) };
    ollama.queue.push(JSON.stringify({ items: [{ name: "Chicken breast", grams: 150 }, { name: "chicken breast", grams: 180 }] }));
    const r = (await worker.runJob(job("photo", { image: "aGVsbG8=" }))) as { items: { name: string; grams: number; ingredientId: string | null }[] };
    expect(updates[0].args).toEqual({ where: { id: "cjob00000000000000000000001" }, data: { input: {} } });
    expect(updates[0].requestsSoFar).toBe(0); // nothing had reached Ollama yet
    expect(ollama.requests).toHaveLength(1);
    expect(ollama.requests[0].path).toBe("/api/chat");
    expect(JSON.stringify(ollama.requests[0].body)).toContain("aGVsbG8=");
    expect(r.items).toEqual([{ name: "Chicken breast", grams: 180, ingredientId: "cing0000000000000000000001", nameEn: "Chicken breast" }]);
  });
});

describe("weekly report summary", () => {
  it("summarises computed numbers only", async () => {
    ollama.queue.push(JSON.stringify({ summary: "A steady week: protein was good, fish twice, add more vegetables." }));
    const r = (await worker.runJob(job("report", { userId: users[0].id }))) as { summary: string; facts: string };
    expect(r.summary).toMatch(/steady week/);
    expect(String(ollama.requests[0].body.prompt)).not.toMatch(/HbA1c|LDL|GGT/);
  });
});

describe("plan generation", () => {
  it("falls back to the rule solver when the model's week breaks the rules", async () => {
    h.overrides.mealPlan = { findUnique: async () => null, upsert: async () => ({ id: "cplan0000000000000000000001" }) };
    ollama.queue.push(JSON.stringify({ days: Array(7).fill({ breakfast: "nope", lunch: "nope", dinner: "nope" }) }), JSON.stringify({ days: Array(7).fill({ breakfast: "nope", lunch: "nope", dinner: "nope" }) }), JSON.stringify({ days: Array(7).fill({ breakfast: "nope", lunch: "nope", dinner: "nope" }) }));
    const r = (await worker.runJob(job("plan", { weekStart: "2026-10-19T00:00:00.000Z" }))) as { planId: string; generatedBy: string };
    expect(r.planId).toBe("cplan0000000000000000000001");
    expect(r.generatedBy).toBe("solver");
    expect(ollama.requests).toHaveLength(3);
  });
});

describe("worker helpers", () => {
  it("errorText never returns an empty string", () => {
    expect(worker.errorText(new Error(""))).toBe("Error");
    expect(worker.errorText(undefined)).toMatch(/unknown error/);
  });
  it("unknown job types fail loudly", async () => {
    await expect(worker.runJob(job("bogus", {}))).rejects.toThrow(/unknown job type/);
  });
  it("prune deletes old jobs and clears stale lab-PDF text", async () => {
    h.overrides.job = { deleteMany: async () => ({ count: 4 }), updateMany: async () => ({ count: 0 }) };
    h.overrides.labImport = { updateMany: async () => ({ count: 2 }) };
    expect(await worker.prune()).toEqual({ jobs: 4, labTexts: 2, photos: 0 });
  });
  it("prune fails queued photo jobs older than 24 h and deletes their photo", async () => {
    const now = new Date("2026-10-20T12:00:00Z");
    const calls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
    h.overrides.job = { updateMany: async (a: (typeof calls)[number]) => (calls.push(a), { count: 3 }) };
    expect((await worker.prune(now)).photos).toBe(3);
    expect(calls).toEqual([
      {
        where: { type: "photo", status: "queued", createdAt: { lt: new Date("2026-10-19T12:00:00Z") } },
        data: { status: "failed", input: {}, error: "abandoned — photo deleted after 24 h" },
      },
    ]);
  });
});
