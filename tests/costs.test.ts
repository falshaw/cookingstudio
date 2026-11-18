import { describe, expect, it } from "vitest";
import { latestUnitPrices, mealCost, receiptMismatch, spendByMonth } from "@/lib/costs";

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("latestUnitPrices", () => {
  it("takes the newest receipt per ingredient and skips lines without weight", () => {
    const p = latestUnitPrices([
      { ingredientId: "beef", price: 9.49, grams: 1000, boughtOn: d("2026-11-18") },
      { ingredientId: "beef", price: 12, grams: 1000, boughtOn: d("2026-10-01") },
      { ingredientId: "sugar", price: 0.9, grams: null, boughtOn: d("2026-11-18") },
      { ingredientId: null, price: 7.99, grams: 1, boughtOn: d("2026-11-18") },
    ]);
    expect(p.get("beef")?.perGram).toBeCloseTo(0.00949);
    expect(p.has("sugar")).toBe(false);
    expect(p.size).toBe(1);
  });
});

describe("mealCost", () => {
  const prices = new Map([
    ["beef", { perGram: 0.01 }],
    ["pepper", { perGram: 0.005 }],
  ]);

  it("prices every line and splits per portion", () => {
    const c = mealCost(
      [
        { ingredientId: "beef", forUserId: null, grams: 400 },
        { ingredientId: "pepper", forUserId: null, grams: 200 },
      ],
      2,
      prices,
    );
    expect(c).toEqual({ total: 5, perPortion: 2.5, priced: 2, lines: 2, complete: true });
  });

  it("says how many lines are priced when some are unknown (a lower bound, not a guess)", () => {
    const c = mealCost(
      [
        { ingredientId: "beef", forUserId: null, grams: 400 },
        { ingredientId: "onion", forUserId: null, grams: 100 },
        { ingredientId: "pepper", forUserId: "alex", grams: 100 },
      ],
      2,
      prices,
    );
    expect(c.priced).toBe(2);
    expect(c.lines).toBe(3);
    expect(c.complete).toBe(false);
    expect(c.total).toBe(4.5);
  });

  it("three people: each person's extra is bought for their share of the servings", () => {
    const people = [{ id: "alex", portionFactor: 1 }, { id: "sam", portionFactor: 1 }, { id: "robin", portionFactor: 1 }];
    const lines = [
      { ingredientId: "beef", forUserId: null, grams: 600 }, // base for 6 servings: 6.00
      { ingredientId: "pepper", forUserId: "robin", grams: 100 }, // one portion 0.50, x 2 (6 servings = 2 meals for 3)
      { ingredientId: "beef", forUserId: "alex", grams: 50 }, // 0.50 x 2
    ];
    expect(mealCost(lines, 6, prices, people)).toEqual({ total: 8, perPortion: 1.33, priced: 3, lines: 3, complete: true });
  });

  it("portion factors weight the extras; extras of someone no longer in the household are not counted", () => {
    const people = [{ id: "alex", portionFactor: 1.5 }, { id: "sam", portionFactor: 0.5 }];
    const lines = [
      { ingredientId: "pepper", forUserId: "alex", grams: 100 }, // 2 servings = 1 meal, x 1.5 = 0.75
      { ingredientId: "pepper", forUserId: "gone", grams: 100 },
    ];
    expect(mealCost(lines, 2, prices, people)).toEqual({ total: 0.75, perPortion: 0.38, priced: 1, lines: 1, complete: true });
  });

  it("an empty recipe is not complete and never divides by zero", () => {
    expect(mealCost([], 0, prices)).toEqual({ total: 0, perPortion: 0, priced: 0, lines: 0, complete: false });
  });
});

describe("spendByMonth", () => {
  it("groups by month, newest first, with the split by kind", () => {
    const rows = spendByMonth([
      { boughtOn: d("2026-11-18"), kind: "food", price: 53.41 },
      { boughtOn: d("2026-11-18"), kind: "household", price: 17.98 },
      { boughtOn: d("2026-10-02"), kind: "drink", price: 5.38 },
    ]);
    expect(rows.map((r) => r.month)).toEqual(["2026-11", "2026-10"]);
    expect(rows[0]).toEqual({ month: "2026-11", total: 71.39, byKind: { food: 53.41, drink: 0, household: 17.98 } });
  });
});

describe("receiptMismatch", () => {
  it("is zero when the lines add up to the printed total", () => {
    expect(receiptMismatch(115.85, [39.08, 23.36, 53.41])).toBe(0);
    expect(receiptMismatch(10, [9.5])).toBe(0.5);
  });
});
