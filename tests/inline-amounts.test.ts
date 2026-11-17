import { describe, expect, it } from "vitest";
import { inlineAmounts, nameVariants } from "@/lib/inline-amounts";

const fmt = (n: number) => String(n);
const join = (segs: ReturnType<typeof inlineAmounts>) => segs.map((s) => ("amount" in s ? `[${s.amount}]` : s.text)).join("");

describe("inlineAmounts", () => {
  it("puts the amount before the first mention", () => {
    const s = inlineAmounts("Add the butter and stir, then more butter.", [{ id: "a", qty: 15, unit: "g", name: "Butter" }], fmt);
    expect(join(s)).toBe("Add the [15 g] butter and stir, then more butter.");
  });
  it("matches a short form of a two-word name and plurals", () => {
    const s = inlineAmounts("Rub the chicken and add the carrots.", [
      { id: "c", qty: 400, unit: "g", name: "Chicken breast" },
      { id: "k", qty: 4, unit: "pc", name: "Carrot" },
    ], fmt);
    expect(join(s)).toBe("Rub the [400 g] chicken and add the [4 pc] carrots.");
  });
  it("leaves text alone when the ingredient is not named, and places a duplicate name once", () => {
    expect(join(inlineAmounts("Toast the bread.", [{ id: "x", qty: 1, unit: "tsp", name: "Salt" }], fmt))).toBe("Toast the bread.");
    const s = inlineAmounts("Toast the rye bread.", [
      { id: "n", qty: 1, unit: "slice", name: "Wholemeal rye bread" },
      { id: "a", qty: 2, unit: "slice", name: "Wholemeal rye bread" },
    ], fmt);
    expect(s.filter((x) => "amount" in x)).toHaveLength(1);
  });
  it("does not match inside other words", () => {
    expect(join(inlineAmounts("Use the pantry oil.", [{ id: "o", qty: 1, unit: "tbsp", name: "Ant" }], fmt))).toBe("Use the pantry oil.");
  });
  it("skips partial and already-measured mentions", () => {
    const lines = [{ id: "b", qty: 15, unit: "g", name: "Butter" }, { id: "o", qty: 2, unit: "tbsp", name: "Olive oil" }];
    expect(join(inlineAmounts("Fry it in half the butter.", lines, fmt))).toBe("Fry it in half the butter.");
    expect(join(inlineAmounts("Use the rest of the butter.", lines, fmt))).toBe("Use the rest of the butter.");
    expect(join(inlineAmounts("Add 1 tbsp olive oil.", lines, fmt))).toBe("Add 1 tbsp olive oil.");
    expect(join(inlineAmounts("Melt the butter, add the olive oil.", lines, fmt))).toBe("Melt the [15 g] butter, add the [2 tbsp] olive oil.");
  });
  it("nameVariants: full name, no brackets, first + last long word", () => {
    expect(nameVariants("Rocket (arugula)")).toEqual(["rocket"]);
    expect(nameVariants("Wholemeal rye bread")).toEqual(["wholemeal rye bread", "wholemeal", "bread"]);
  });
});

describe("amountsForSteps", () => {
  it("places each amount only at the first step that names it, longest names first", async () => {
    const { amountsForSteps } = await import("@/lib/inline-amounts");
    const all = [
      { id: "c", qty: 4, unit: "pc", name: "Carrot" },
      { id: "o", qty: 0.5, unit: "pc", name: "Onion" },
      { id: "r", qty: 0.5, unit: "pc", name: "Red onion" },
      { id: "s", qty: 1, unit: "tsp", name: "Salt" },
    ];
    const segs = amountsForSteps([
      { text: "Toss the carrots with a pinch of salt.", lineIds: ["c", "s"] },
      { text: "Add the red onion.", lineIds: ["o", "r"] },
      { text: "Put the kofta and carrots on top, salt to taste.", lineIds: [] },
    ], all, (n) => String(n));
    expect(join(segs[0])).toBe("Toss the [4 pc] carrots with a pinch of salt.");
    expect(join(segs[1])).toBe("Add the [0.5 pc] red onion.");
    expect(segs[1].find((x) => "amount" in x && x.lineId === "r")).toBeTruthy();
    expect(join(segs[2])).toBe("Put the kofta and carrots on top, [1 tsp] salt to taste.");
  });
});
