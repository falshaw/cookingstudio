import { describe, expect, it } from "vitest";
import { guardAvoids, mergeShopping, roundForShop, sectionOrder, whatsappText, type Contribution } from "@/lib/shopping";
import type { RuleProfile } from "@/lib/rules";
import { packsFor } from "@/lib/shopping-build";

const c = (o: Partial<Contribution>): Contribution => ({ ingredientId: "onion", name: "Onion", section: "produce", qty: 1, unit: "pc", forUserId: null, ...o });

describe("shopping-list merge", () => {
  it("sums the same ingredient + unit + who", () => {
    const m = mergeShopping([c({ qty: 1 }), c({ qty: 0.5 }), c({ qty: 2 })]);
    expect(m).toHaveLength(1);
    expect(m[0].qty).toBe(4); // 3.5 rounded up to whole onions
  });
  it("keeps different units and Alex's extras apart", () => {
    const m = mergeShopping([c({ qty: 1 }), c({ qty: 150, unit: "g" }), c({ qty: 1, forUserId: "alex" })]);
    expect(m).toHaveLength(3);
    expect(m.find((x) => x.forUserId === "alex")?.qty).toBe(1);
    expect(m.filter((x) => x.forUserId == null)).toHaveLength(2);
  });
  it("groups by supermarket section in aisle order", () => {
    const m = mergeShopping([c({ ingredientId: "spice", name: "Cumin", section: "spices", unit: "tsp" }), c({ ingredientId: "fish", name: "Salmon", section: "fish", unit: "g", qty: 150 }), c({})]);
    expect(m.map((x) => x.section)).toEqual(["produce", "fish", "spices"]);
    expect(sectionOrder("produce")).toBeLessThan(sectionOrder("pantry"));
  });
  it("marks items already in stock", () => {
    expect(mergeShopping([c({})], new Set(["onion"]))[0].inPantry).toBe(true);
  });
  it("rounds grams up to 5 g and count units up", () => {
    expect(roundForShop(151, "g")).toBe(155);
    expect(roundForShop(2.1, "clove")).toBe(3);
  });
  it("works out realistic packs and leftovers", () => {
    expect(packsFor(300, "g", 250, "g")).toEqual({ packs: 2, rest: 200 });
    expect(packsFor(250, "g", 250, "g")).toEqual({ packs: 1, rest: 0 });
    expect(packsFor(2, "tbsp", 500, "ml")).toBeNull();
  });
});

describe("avoid-list guard", () => {
  const person = (slug: string, name: string, avoidFoods: string[], o: Partial<RuleProfile> = {}): RuleProfile => ({ id: slug, slug, name, vegetarian: false, vegBreakfastAllowed: [], avoidFoods, noAlcohol: false, noAddedSugar: false, noRefinedStarch: false, maxNetCarbsPerMeal: null, minProteinPerMeal: null, maxCookMinutes: null, omega3MinPerWeek: null, omega3MaxPerWeek: null, ...o });
  const alex = person("alex", "Alex", ["prawns", "sour-cream", "coconut"], { avoidExceptions: [{ allow: "coconut-milk", contexts: ["curry", "thai"] }] });
  const sam = person("sam", "Sam", ["mushroom"]);
  const prawns = c({ ingredientId: "prawns", slug: "prawns", name: "Prawns (raw, peeled)", section: "frozen", unit: "g", qty: 180, forUserId: "alex" });
  const yogurt = c({ ingredientId: "yog", slug: "sour-cream", name: "Sour cream", section: "dairy", unit: "g", qty: 150 });

  it("leaves out a person's own extra that is on their avoid list, with a short note", () => {
    const r = guardAvoids([prawns, c({ slug: "onion" })], [alex, sam]);
    expect(r.items.map((i) => i.ingredientId)).toEqual(["onion"]);
    expect(r.leftOut).toEqual(["Prawns (Alex avoids)"]);
  });
  it("only checks an extra against its owner's list", () => {
    const r = guardAvoids([{ ...prawns, forUserId: "sam" }, c({ ingredientId: "mush", slug: "mushroom", name: "Mushroom", forUserId: "alex" })], [alex, sam]);
    expect(r.items).toHaveLength(2);
    expect(r.leftOut).toEqual([]);
  });
  it("keeps a shared line on someone's avoid list and tags it through the merge", () => {
    const r = guardAvoids([yogurt, yogurt, c({ ingredientId: "mush", slug: "mushroom", name: "Mushroom", unit: "g", qty: 200 })], [alex, sam]);
    expect(r.leftOut).toEqual([]);
    const m = mergeShopping(r.items);
    expect(m.find((i) => i.ingredientId === "yog")).toMatchObject({ qty: 300, avoidNote: "Alex avoids" });
    expect(m.find((i) => i.ingredientId === "mush")?.avoidNote).toBe("Sam avoids");
    expect(mergeShopping([c({ slug: "onion" })])[0].avoidNote).toBe("");
  });
  it("names both people when both avoid a shared line", () => {
    const both = guardAvoids([yogurt], [alex, person("sam", "Sam", ["cream"])]);
    expect(mergeShopping(both.items)[0].avoidNote).toBe("Alex & Sam avoid");
  });
  it("respects avoid exceptions from the recipe context (coconut milk in a Thai curry)", () => {
    const milk = c({ ingredientId: "cm", slug: "coconut-milk", name: "Coconut milk", unit: "ml", qty: 250 });
    expect(guardAvoids([{ ...milk, ctx: { title: "Thai green curry", cuisine: "thai" } }], [alex]).items[0].avoidBy).toBeUndefined();
    expect(guardAvoids([{ ...milk, ctx: { title: "Smoothie" } }], [alex]).items[0].avoidBy).toEqual(["Alex"]);
  });
  it("three people: each extra is checked against its own owner, a shared line names everyone who avoids it", () => {
    const robin = person("robin", "Robin", ["sour-cream", "onion"]);
    const r = guardAvoids([yogurt, c({ slug: "onion", forUserId: "robin" }), c({ ingredientId: "onion2", slug: "onion", name: "Onion", forUserId: "sam" })], [alex, sam, robin]);
    expect(r.leftOut).toEqual(["Onion (Robin avoids)"]);
    expect(r.items.map((i) => i.forUserId)).toEqual([null, "sam"]);
    expect(mergeShopping(r.items).find((i) => i.ingredientId === "yog")?.avoidNote).toBe("Alex & Robin avoid");
    const all = guardAvoids([yogurt], [alex, { ...sam, avoidFoods: ["sour-cream"] }, robin]);
    expect(mergeShopping(all.items)[0].avoidNote).toBe("Alex, Robin & Sam avoid"); // names sorted
  });
  it("passes lines without a slug (stock top-ups) through untouched", () => {
    expect(guardAvoids([{ ...prawns, slug: undefined }], [alex]).items).toHaveLength(1);
  });
});

describe("WhatsApp text", () => {
  const it0 = { qty: 1, unit: "pc", forName: "", inPantry: false, packNote: "", checked: false };
  const items = [
    { ...it0, name: "Lemon", section: "produce", packNote: "buy 1 × 1 kg net (~8) · 7 pc left over" },
    { ...it0, name: "Feta", section: "cheese", qty: 100, unit: "g", forName: "Sam" },
    { ...it0, name: "Capers", section: "pantry", inPantry: true },
    { ...it0, name: "Tomatoes", section: "produce", checked: true },
  ];
  const fmt = (n: number) => String(n);
  it("lists only what is still to buy, by aisle in shop order, with the first pack note", () => {
    const t = whatsappText("Weekly shop", items, { hidePantry: true, fmt });
    expect(t).toBe("*Weekly shop*\n\n*Fruit & veg*\n• Lemon — 1 pc · buy 1 × 1 kg net (~8)\n\n*Cheese & deli*\n• Feta [Sam] — 100 g");
  });
  it("appends the avoid tag to tagged items", () => {
    const t = whatsappText("L", [{ ...it0, name: "Greek yogurt", section: "dairy", qty: 375, unit: "g", avoidNote: "Alex avoids" }], { hidePantry: true, fmt });
    expect(t).toContain("• Greek yogurt — 375 g ⚠ Alex avoids");
  });
  it("keeps pantry items when they are not hidden, and says when all is ticked", () => {
    expect(whatsappText("L", items, { hidePantry: false, fmt })).toContain("• Capers — 1 pc");
    expect(whatsappText("L", items.map((i) => ({ ...i, checked: true })), { hidePantry: false, fmt })).toBe("*L*\n\nEverything is ticked.");
  });
});
