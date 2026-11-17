import { describe, expect, it } from "vitest";
import { baseFactor, clampServings, extraFactor, scaleLines } from "@/lib/scale";

const lines = [
  { id: "a", component: "both", qty: 400, grams: 400, unit: "g" },
  { id: "b", component: "alex", qty: 150, grams: 150, unit: "g" },
  { id: "c", component: "sam", qty: 75, grams: 75, unit: "g" },
];

describe("servings scaler", () => {
  it("keeps quantities at the recipe's own servings", () => {
    expect(scaleLines(lines, 2, 2).map((l) => l.qty)).toEqual([400, 150, 75]);
  });
  it("doubles base and per-person extras for 4 servings", () => {
    const s = scaleLines(lines, 2, 4);
    expect(s[0].qty).toBe(800);
    expect(s[1].qty).toBe(300);
    expect(s[2].grams).toBe(150);
  });
  it("scales a 6-portion prep batch down to 3", () => {
    expect(baseFactor(6, 3)).toBe(0.5);
    expect(extraFactor(6)).toBe(3);
  });
  it("clamps silly input", () => {
    expect(clampServings(0)).toBe(1);
    expect(clampServings(99)).toBe(24);
    expect(clampServings(Number.NaN)).toBe(2);
  });
});
