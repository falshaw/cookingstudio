import { describe, expect, it } from "vitest";
import { baseFactor, clampServings, defaultServings, extraFactor, rounds, scaleLines, servingsFor } from "@/lib/scale";

const lines = [
  { id: "a", forUserId: null, qty: 400, grams: 400, unit: "g" },
  { id: "b", forUserId: "alex", qty: 150, grams: 150, unit: "g" },
  { id: "c", forUserId: "sam", qty: 75, grams: 75, unit: "g" },
];

const two = [{ id: "alex", portionFactor: 1 }, { id: "sam", portionFactor: 1 }];
const three = [...two, { id: "robin", portionFactor: 1 }];

describe("servings scaler", () => {
  it("keeps quantities at the recipe's own servings", () => {
    expect(scaleLines(lines, 2, 2, two).map((l) => l.qty)).toEqual([400, 150, 75]);
  });
  it("doubles base and per-person extras for 4 servings", () => {
    const s = scaleLines(lines, 2, 4, two);
    expect(s[0].qty).toBe(800);
    expect(s[1].qty).toBe(300);
    expect(s[2].grams).toBe(150);
  });
  it("scales a 6-portion prep batch down to 3", () => {
    expect(baseFactor(6, 3)).toBe(0.5);
    expect(extraFactor(6, two, "alex")).toBe(3);
  });
  it("three people: 3 servings = one meal, each extra once; 6 servings = two each", () => {
    expect(scaleLines(lines, 2, 3, three).map((l) => l.qty)).toEqual([600, 150, 75]);
    expect(extraFactor(6, three, "robin")).toBe(2);
    expect(rounds(6, three)).toBe(2);
    expect(servingsFor(three)).toBe(3);
    expect(defaultServings(2, three)).toBe(3); // a 2-serving recipe opens as one meal for three
    expect(defaultServings(2, two)).toBe(2);
    expect(defaultServings(6, three)).toBe(6); // a prep batch keeps its own size
  });
  it("weights extras by portion factor and drops extras of someone not in the household", () => {
    const people = [{ id: "alex", portionFactor: 1.5 }, { id: "sam", portionFactor: 0.5 }];
    expect(extraFactor(2, people, "alex")).toBe(1.5);
    expect(extraFactor(2, people, "sam")).toBe(0.5);
    expect(scaleLines(lines, 2, 2, [{ id: "alex", portionFactor: 1 }]).map((l) => l.id)).toEqual(["a", "b"]);
  });
  it("clamps silly input", () => {
    expect(clampServings(0)).toBe(1);
    expect(clampServings(99)).toBe(24);
    expect(clampServings(Number.NaN)).toBe(2);
  });
});
