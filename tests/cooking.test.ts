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
  it("gives Sam's steps to Sam and overlaps work", () => {
    const r = cookTogether([
      { n: 1, who: "sam", minutes: 5, text: "wash" },
      { n: 2, who: "alex", minutes: 10, text: "sear" },
      { n: 3, who: "either", minutes: 5, text: "stir" },
    ]);
    expect(r.items.find((i) => i.n === 1)?.lane).toBe("sam");
    expect(r.items.find((i) => i.n === 2)?.lane).toBe("alex");
    expect(r.total).toBeLessThan(20);
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
    const lines = [{ component: "both", grams: 400, ref: egg }, { component: "alex", grams: 100, ref: egg }];
    expect(Math.round(portionMacros(lines, 2, "alex").protein)).toBe(38);
    expect(Math.round(portionMacros(lines, 2, "sam").protein)).toBe(25);
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
