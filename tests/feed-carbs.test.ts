import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
import { carbSources } from "@/lib/feed";

const ing = (nameEn: string, fdcId: number, forUserId: string | null, grams: number) => ({ forUserId, grams, ingredient: { nameEn, fdcId } });
const nut = new Map([
  [1, { carbs: 20, fibre: 3 }], // sweet potato: 17 g net / 100 g
  [2, { carbs: 0, fibre: 0 }], // pork
  [3, { carbs: 5, fibre: 2.5 }], // broccoli: 2.5 g net / 100 g
  [4, { carbs: 60, fibre: 15 }], // lentils (dry): 45 g net / 100 g
]);

describe("carbSources (feed retry feedback)", () => {
  it("splits the shared base by servings, adds own lines, ignores the other person's, biggest first", () => {
    const lines = [ing("Sweet potato", 1, null, 600), ing("Pork shoulder", 2, null, 900), ing("Broccoli", 3, "alex", 200), ing("Red lentils", 4, "sam", 80)];
    const out = carbSources(lines, nut, 6, "alex", 1);
    expect(out.map((o) => o.name)).toEqual(["Sweet potato", "Broccoli"]); // pork 0 g dropped, lentils are Sam's
    expect(out[0]).toEqual({ name: "Sweet potato", grams: 100, netCarbs: 17 });
    expect(out[1]).toEqual({ name: "Broccoli", grams: 200, netCarbs: 5 });
  });
  it("applies the portion factor", () => {
    expect(carbSources([ing("Sweet potato", 1, null, 600)], nut, 6, "alex", 1.5)[0]).toEqual({ name: "Sweet potato", grams: 150, netCarbs: 25.5 });
  });
});
