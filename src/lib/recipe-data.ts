// Server-side recipe loading + per-person macros and rule inputs.
import { prisma } from "./prisma";
import { portionMacros, roundMacros, type CompLine, type Macros, type Per100 } from "./nutrition";
import type { AvoidException, RuleLine, RuleProfile } from "./rules";

export async function nutritionMap(fdcIds: (number | null)[]): Promise<Map<number, Per100>> {
  const ids = [...new Set(fdcIds.filter((x): x is number => x != null))];
  if (!ids.length) return new Map();
  const rows = await prisma.nutritionRef.findMany({ where: { fdcId: { in: ids } } });
  return new Map(rows.map((r) => [r.fdcId, r]));
}

export const recipeInclude = {
  ingredients: { include: { ingredient: true }, orderBy: { sort: "asc" as const } },
  steps: { orderBy: { n: "asc" as const }, include: { image: { select: { id: true, status: true } } } },
  hero: { select: { id: true, status: true, video: true } },
};

export async function loadRecipe(slug: string) {
  return prisma.recipe.findUnique({ where: { slug }, include: recipeInclude });
}

export type FullRecipe = NonNullable<Awaited<ReturnType<typeof loadRecipe>>>;

type LineLike = { component: string; grams: number; ingredient: { slug: string; nameEn: string; fdcId: number | null; isMeat: boolean; isFish: boolean; isOmega3: boolean; isAlcohol: boolean; isAddedSugar: boolean; isRefinedStarch: boolean } };

export function compLines(lines: LineLike[], nut: Map<number, Per100>): CompLine[] {
  return lines.map((l) => ({ component: l.component, grams: l.grams, ref: l.ingredient.fdcId != null ? nut.get(l.ingredient.fdcId) ?? null : null }));
}

export function ruleLines(lines: LineLike[]): RuleLine[] {
  return lines.map((l) => ({
    slug: l.ingredient.slug,
    nameEn: l.ingredient.nameEn,
    component: l.component,
    grams: l.grams,
    isMeat: l.ingredient.isMeat,
    isFish: l.ingredient.isFish,
    isOmega3: l.ingredient.isOmega3,
    isAlcohol: l.ingredient.isAlcohol,
    isAddedSugar: l.ingredient.isAddedSugar,
    isRefinedStarch: l.ingredient.isRefinedStarch,
  }));
}

export interface PersonMacros {
  generic: Macros;
  alex: Macros;
  sam: Macros;
}

export function recipeMacros(servings: number, lines: CompLine[], pf: { alex: number; sam: number } = { alex: 1, sam: 1 }): PersonMacros {
  return {
    generic: roundMacros(portionMacros(lines, servings, null)),
    alex: roundMacros(portionMacros(lines, servings, "alex", pf.alex)),
    sam: roundMacros(portionMacros(lines, servings, "sam", pf.sam)),
  };
}

export async function loadProfiles() {
  const users = await prisma.user.findMany({ include: { profile: true, dislikes: { select: { recipeId: true, ingredient: { select: { slug: true } } } } }, orderBy: { slug: "desc" } }); // alex, sam
  return users;
}

export function toRuleProfile(u: { slug: string; name: string; profile: null | { vegetarian: boolean; vegBreakfastAllowed: string[]; avoidFoods: string[]; noAlcohol: boolean; noAddedSugar: boolean; noRefinedStarch: boolean; maxNetCarbsPerMeal: number | null; minProteinPerMeal: number | null; maxCookMinutes: number | null; maxLunchMinutes?: number | null; omega3MinPerWeek: number | null; omega3MaxPerWeek: number | null; redMeatMaxPerWeek?: number | null; avoidExceptions?: unknown }; dislikes?: { recipeId: string | null; ingredient: { slug: string } | null }[] }): RuleProfile {
  const p = u.profile;
  const dis = u.dislikes ?? [];
  return {
    slug: u.slug,
    name: u.name,
    vegetarian: p?.vegetarian ?? false,
    vegBreakfastAllowed: p?.vegBreakfastAllowed ?? [],
    // ingredient dislikes act like this person's avoid list
    avoidFoods: [...(p?.avoidFoods ?? []), ...dis.map((d) => d.ingredient?.slug).filter((s): s is string => !!s)],
    dislikedRecipeIds: dis.map((d) => d.recipeId).filter((s): s is string => !!s),
    avoidExceptions: Array.isArray(p?.avoidExceptions) ? (p!.avoidExceptions as unknown as AvoidException[]) : [],
    noAlcohol: p?.noAlcohol ?? false,
    noAddedSugar: p?.noAddedSugar ?? false,
    noRefinedStarch: p?.noRefinedStarch ?? false,
    maxNetCarbsPerMeal: p?.maxNetCarbsPerMeal ?? null,
    minProteinPerMeal: p?.minProteinPerMeal ?? null,
    maxCookMinutes: p?.maxCookMinutes ?? null,
    maxLunchMinutes: p?.maxLunchMinutes ?? null,
    omega3MinPerWeek: p?.omega3MinPerWeek ?? null,
    omega3MaxPerWeek: p?.omega3MaxPerWeek ?? null,
    redMeatMaxPerWeek: p?.redMeatMaxPerWeek ?? null,
  };
}
