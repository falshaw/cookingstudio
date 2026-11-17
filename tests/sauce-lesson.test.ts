// Recipe page "The sauce in this dish" link per viewer: a viewer who disliked béchamel is linked to velouté instead.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makePrisma, type Overrides } from "./helpers/fake-prisma";

const h = vi.hoisted(() => ({ overrides: {} as Overrides }));
vi.mock("@/lib/prisma", () => ({
  get prisma() {
    return makePrisma(h.overrides).client;
  },
}));
import { viewerSauceLesson } from "@/lib/sauce-lesson";

const lesson = (slug: string, level: number, ing: string[]) => ({ slug, title: slug, sauceFamily: "mother", level, ingredients: ing.map((ingredientId) => ({ ingredientId })) });
const MOTHER = [lesson("bechamel", 3, ["butter", "flour", "milk"]), lesson("espagnole", 6, ["butter", "flour", "tomato-paste"]), lesson("veloute", 4, ["butter", "flour", "stock"])];

function setup(disliked: string[], linkedExists = true) {
  h.overrides = {
    recipe: { findFirst: async () => (linkedExists ? { sauceFamily: "mother" } : null), findMany: async () => MOTHER },
    dislike: { findMany: async () => disliked.map((slug) => ({ recipe: { slug } })) },
    recipeIngredient: { findMany: async () => ["egg", "butter", "flour", "stock", "cream"].map((ingredientId) => ({ ingredientId })) },
  };
}

describe("viewerSauceLesson", () => {
  beforeEach(() => setup([]));
  it("shows the linked lesson to a viewer who did not dislike it", async () => {
    expect(await viewerSauceLesson("crecipe", "bechamel", "cuser")).toEqual({ slug: "bechamel", title: "bechamel" });
  });
  it("falls back to the closest liked lesson of the family for a viewer who disliked it", async () => {
    setup(["bechamel"]);
    expect((await viewerSauceLesson("crecipe", "bechamel", "cuser"))?.slug).toBe("veloute");
  });
  it("no link when the whole family is disliked, the lesson is gone, or none is set", async () => {
    setup(["bechamel", "espagnole", "veloute"]);
    expect(await viewerSauceLesson("crecipe", "bechamel", "cuser")).toBeNull();
    setup([], false);
    expect(await viewerSauceLesson("crecipe", "bechamel", "cuser")).toBeNull();
    expect(await viewerSauceLesson("crecipe", null, "cuser")).toBeNull();
  });
});
