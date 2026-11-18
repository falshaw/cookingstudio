import { describe, expect, it } from "vitest";
import { legacyOwnerSlugs, legacySkill, nameList, normalizeLegacyDraft, ownsLine, portionSum, possessive, toMember } from "@/lib/household";
import { seedUsers } from "../prisma/seed-users";
import { RecipeDraft } from "@/lib/llm-schema";
import { checkPortion, isOmega3Portion, type RuleProfile } from "@/lib/rules";
import { inferFlags } from "@/lib/flags";
import { ZERO } from "@/lib/nutrition";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("household helpers", () => {
  it("names lists of any length", () => {
    expect(nameList([])).toBe("");
    expect(nameList(["Alex"])).toBe("Alex");
    expect(nameList(["Alex", "Sam"])).toBe("Alex & Sam");
    expect(nameList(["Alex", "Sam", "Robin"])).toBe("Alex, Sam & Robin");
    expect(possessive("Robin")).toBe("Robin's");
  });
  it("a shared line belongs to everyone, an extra only to its owner", () => {
    expect(ownsLine({ forUserId: null }, "robin")).toBe(true);
    expect(ownsLine({ forUserId: "alex" }, "robin")).toBe(false);
    expect(ownsLine({ forUserId: "alex" }, null)).toBe(false);
  });
  it("portion sum and member defaults", () => {
    expect(portionSum([{ portionFactor: 1 }, { portionFactor: 0.75 }, { portionFactor: 0 }])).toBe(2.75);
    expect(toMember({ id: "u", slug: "robin", name: "Robin", profile: null })).toEqual({ id: "u", slug: "robin", name: "Robin", portionFactor: 1, cookingSkill: "beginner" });
  });
});

describe("rules for a third person", () => {
  const p = (id: string, o: Partial<RuleProfile> = {}): RuleProfile => ({ id, slug: id, name: id, vegetarian: false, vegBreakfastAllowed: [], avoidFoods: [], noAlcohol: false, noAddedSugar: false, noRefinedStarch: false, maxNetCarbsPerMeal: null, minProteinPerMeal: null, maxCookMinutes: null, omega3MinPerWeek: null, omega3MaxPerWeek: null, ...o });
  const line = (slug: string, nameEn: string, forUserId: string | null, grams = 150) => ({ slug, nameEn, forUserId, grams, ...inferFlags(nameEn) });
  const lines = [line("courgette", "Courgette", null, 400), line("salmon", "Salmon fillet", "alex"), line("ribeye", "Ribeye steak", "sam")];
  it("checks only the shared base and the person's own extras", () => {
    const robin = p("robin", { vegetarian: true });
    expect(checkPortion(robin, { title: "t", meal: "dinner", totalMinutes: 20, lines, macros: ZERO })).toEqual([]);
    expect(checkPortion(p("sam", { vegetarian: true }), { title: "t", meal: "dinner", totalMinutes: 20, lines, macros: ZERO }).map((i) => i.code)).toEqual(["vegetarian"]);
    expect(isOmega3Portion(lines, "alex")).toBe(true);
    expect(isOmega3Portion(lines, "robin")).toBe(false);
  });
});

describe("legacy alex/sam data", () => {
  const users = [
    { id: "u2", slug: "robin", createdAt: d("2026-01-02") },
    { id: "u1", slug: "kim", createdAt: d("2026-01-01") },
    { id: "u3", slug: "lee", createdAt: d("2026-01-03") },
  ];
  it("maps the old handles to the users with those slugs", () => {
    expect(legacyOwnerSlugs([...users, { id: "a", slug: "alex", createdAt: d("2026-02-01") }, { id: "s", slug: "sam", createdAt: d("2026-02-01") }])).toEqual({ alex: "alex", sam: "sam" });
  });
  it("without those slugs: the oldest user is alex, the next oldest sam", () => {
    expect(legacyOwnerSlugs(users)).toEqual({ alex: "kim", sam: "robin" });
    expect(legacyOwnerSlugs([users[0]])).toEqual({ alex: "robin", sam: null });
  });
  it("old step lanes become skills", () => {
    expect(["alex", "sam", "either", "", "skilled"].map(legacySkill)).toEqual(["skilled", "beginner", "either", "either", "skilled"]);
  });
  it("converts an old export to the current draft (and drops an extra for nobody)", () => {
    const old = {
      title: "Old dish", servings: 2, prepMinutes: 5, cookMinutes: 10,
      ingredients: [
        { name: "Courgette", grams: 400, qty: 400, unit: "g", prep: "", component: "both" },
        { name: "Salmon fillet", grams: 150, qty: 150, unit: "g", prep: "", component: "alex" },
        { name: "Rice", grams: 75, qty: 75, unit: "g", prep: "", component: "sam" },
      ],
      steps: [{ text: "Sear the salmon fillet.", who: "alex" }, { text: "Wash the rice well.", who: "sam" }],
    };
    const out = RecipeDraft.parse(normalizeLegacyDraft(old, { alex: "kim", sam: null }));
    expect(out.ingredients.map((i) => [i.name, i.for])).toEqual([["Courgette", ""], ["Salmon fillet", "kim"]]);
    expect(out.steps.map((s) => s.skill)).toEqual(["skilled", "beginner"]);
    const current = { ...old, ingredients: [{ name: "Courgette", grams: 1, qty: 1, unit: "g", for: "robin" }], steps: [{ text: "Stir it well.", skill: "either" }] };
    expect(normalizeLegacyDraft(current, { alex: "kim", sam: null })).toEqual(current);
  });
});

describe("seed household from the environment", () => {
  const pw = "a-long-enough-test-pw";
  it("defaults to alex,sam and reads any number of people", () => {
    expect(seedUsers({ SEED_ALEX_PASSWORD: pw, SEED_SAM_PASSWORD: pw }).map((u) => u.slug)).toEqual(["alex", "sam"]);
    const three = seedUsers({ SEED_USERS: "alex, sam,robin", SEED_ALEX_PASSWORD: pw, SEED_SAM_PASSWORD: pw, SEED_ROBIN_PASSWORD: pw, SEED_ROBIN_NAME: "Robin R" });
    expect(three.map((u) => [u.slug, u.name, u.email])).toEqual([["alex", "Alex", "alex@example.com"], ["sam", "Sam", "sam@example.com"], ["robin", "Robin R", "robin@example.com"]]);
    expect(seedUsers({ SEED_USERS: "kim-lee", SEED_KIM_LEE_PASSWORD: pw, SEED_KIM_LEE_EMAIL: "Kim@Example.com" })[0]).toMatchObject({ slug: "kim-lee", name: "Kim-lee", email: "kim@example.com" });
  });
  it("refuses missing, short or placeholder passwords and bad slugs", () => {
    expect(() => seedUsers({ SEED_USERS: "robin" })).toThrow(/SEED_ROBIN_PASSWORD missing/);
    expect(() => seedUsers({ SEED_USERS: "robin", SEED_ROBIN_PASSWORD: "short" })).toThrow(/12 characters/);
    expect(() => seedUsers({ SEED_USERS: "robin", SEED_ROBIN_PASSWORD: "change-me-12-chars-or-more" })).toThrow(/placeholder/);
    expect(() => seedUsers({ SEED_USERS: "Robin!", SEED_ROBIN_PASSWORD: pw })).toThrow(/not a valid slug/);
    expect(() => seedUsers({ SEED_USERS: " , " })).toThrow(/empty/);
  });
});
