import { describe, expect, it } from "vitest";
import { clock, cookTogether, detectTimers } from "@/lib/cooking";
import { portionMacros, sumMacros } from "@/lib/nutrition";
import { computeTaste } from "@/lib/taste";

describe("timer detection", () => {
  it("finds labelled timers and uses the upper bound of a range", () => {
    const t = detectTimers("Simmer for 10 minutes, then bake 25–30 min until golden. Rest 5 minutes.");
    expect(t.map((x) => x.seconds)).toEqual([600, 1800, 300]);
    expect(t[0].label).toMatch(/^Simmer/);
  });
  it("ignores quantities that are not times", () => {
    expect(detectTimers("Add 2 tbsp oil and 400 g tomatoes")).toEqual([]);
  });
  it("formats a clock", () => {
    expect(clock(65)).toBe("1:05");
    expect(clock(3700)).toBe("1:01:40");
  });
});

describe("cook-together timeline", () => {
  const alex = { id: "alex", name: "Alex", skill: "skilled" as const };
  const sam = { id: "sam", name: "Sam", skill: "beginner" as const };
  const robin = { id: "robin", name: "Robin", skill: "beginner" as const };
  const steps = [
    { n: 1, skill: "beginner", minutes: 5, text: "wash" },
    { n: 2, skill: "skilled", minutes: 10, text: "sear" },
    { n: 3, skill: "either", minutes: 5, text: "stir" },
  ];
  it("gives beginner-safe steps to the beginner, the searing to the skilled cook, and overlaps work", () => {
    const r = cookTogether(steps, [alex, sam]);
    expect(r.items.find((i) => i.n === 1)?.lane).toBe("sam");
    expect(r.items.find((i) => i.n === 2)?.lane).toBe("alex");
    expect(r.total).toBeLessThan(20);
    expect(r.ends).toEqual({ alex: 10, sam: 10 });
  });
  it("splits over three cooks; a beginner never gets a skilled step while a skilled cook exists", () => {
    const many = [
      { n: 1, skill: "beginner", minutes: 5, text: "wash" },
      { n: 2, skill: "beginner", minutes: 5, text: "peel" },
      { n: 3, skill: "skilled", minutes: 10, text: "dice" },
      { n: 4, skill: "skilled", minutes: 10, text: "sear" },
      { n: 5, skill: "either", minutes: 5, text: "stir" },
    ];
    const r = cookTogether(many, [alex, sam, robin]);
    const lane = (n: number) => r.items.find((i) => i.n === n)?.lane;
    expect([lane(1), lane(2)].sort()).toEqual(["robin", "sam"]); // both beginners work at the same time
    expect([lane(3), lane(4)]).toEqual(["alex", "alex"]);
    expect(lane(5)).not.toBe("alex");
    expect(Object.keys(r.ends).sort()).toEqual(["alex", "robin", "sam"]);
    expect(r.total).toBe(Math.max(...Object.values(r.ends)));
  });
  it("one cook does everything; nobody skilled → skilled steps go to whoever is free", () => {
    const solo = cookTogether(steps, [sam]);
    expect(solo.items.every((i) => i.lane === "sam")).toBe(true);
    expect(solo.total).toBe(20);
    const beginners = cookTogether(steps, [sam, robin]);
    expect(beginners.items.find((i) => i.n === 2)?.lane).toBe("robin");
    expect(cookTogether(steps, []).items).toEqual([]);
  });
});

describe("nutrition (USDA per 100 g)", () => {
  const egg = { kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5, satFat: 3.1, fibre: 0, sugar: 0.4 };
  const raspberry = { kcal: 52, protein: 1.2, carbs: 11.9, fat: 0.7, satFat: 0, fibre: 6.5, sugar: 4.4 };
  it("sums grams × per-100 values and subtracts fibre for net carbs", () => {
    const m = sumMacros([{ grams: 200, ref: egg }, { grams: 100, ref: raspberry }]);
    expect(Math.round(m.protein * 10) / 10).toBe(26.4);
    expect(Math.round(m.netCarbs * 10) / 10).toBe(6.8);
  });
  it("counts unknown ingredients instead of guessing", () => {
    expect(sumMacros([{ grams: 50, ref: null }]).unknownGrams).toBe(50);
  });
  it("adds a person's extras to their share of the base", () => {
    const lines = [{ forUserId: null, grams: 400, ref: egg }, { forUserId: "alex", grams: 100, ref: egg }];
    expect(Math.round(portionMacros(lines, 2, "alex").protein)).toBe(38);
    expect(Math.round(portionMacros(lines, 2, "sam").protein)).toBe(25);
    expect(Math.round(portionMacros(lines, 2, null).protein)).toBe(25);
  });
});

describe("taste profile (computed in code)", () => {
  it("weights favourites and ratings, learns dislikes from rejections", () => {
    const t = computeTaste([
      { cuisine: "Italian", protein: "beef", sauceFamily: "pan", flavourTags: ["rich"], techniques: ["sear"], spiceLevel: 1, favourite: true, ratings: [5, 5], rejected: false, tweaks: ["less salt"] },
      { cuisine: "Indian", protein: "chicken", sauceFamily: "curry", flavourTags: ["spiced"], techniques: [], spiceLevel: 3, favourite: false, ratings: [], rejected: true, tweaks: [] },
    ]);
    expect(t.cuisines[0][0]).toBe("italian");
    expect(t.dislikes).toContain("chicken");
    expect(t.tweakWords).toContain("less salt");
    expect(t.spice).toBe(1);
  });
});
