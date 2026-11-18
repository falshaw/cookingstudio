// Server side of grocery spending + meal cost. Maths in ./costs.ts (pure, tested).
import { prisma } from "@/lib/prisma";
import { latestUnitPrices, mealCost, type MealCost, type SpendKind } from "@/lib/costs";
import { HOUSEHOLD_ORDER } from "@/lib/household";

/** { id, portionFactor } of every household member, for per-person extras. */
async function household() {
  const users = await prisma.user.findMany({ orderBy: HOUSEHOLD_ORDER, select: { id: true, profile: { select: { portionFactor: true } } } });
  return users.map((u) => ({ id: u.id, portionFactor: u.profile?.portionFactor ?? 1 }));
}

/** Latest price per gram for every ingredient that was bought with a known weight. */
export async function loadUnitPrices() {
  const items = await prisma.purchaseItem.findMany({
    where: { ingredientId: { not: null }, grams: { not: null } },
    select: { ingredientId: true, price: true, grams: true, purchase: { select: { boughtOn: true } } },
    orderBy: [{ purchase: { boughtOn: "asc" } }, { sort: "asc" }],
  });
  return latestUnitPrices(items.map((i) => ({ ingredientId: i.ingredientId, price: i.price, grams: i.grams, boughtOn: i.purchase.boughtOn })));
}

/** Meal cost of one recipe (by id), or null when nothing in it has a price yet. */
export async function recipeCost(recipeId: string): Promise<MealCost | null> {
  const [prices, people, r] = await Promise.all([
    loadUnitPrices(),
    household(),
    prisma.recipe.findUnique({ where: { id: recipeId }, select: { servings: true, ingredients: { select: { ingredientId: true, forUserId: true, grams: true } } } }),
  ]);
  if (!r) return null;
  const c = mealCost(r.ingredients, r.servings, prices, people);
  return c.priced > 0 ? c : null;
}

/** Meal cost of every published plan/prep recipe that has at least one priced line, best coverage first. */
export async function recipeCosts() {
  const prices = await loadUnitPrices();
  if (prices.size === 0) return [];
  const people = await household();
  const recipes = await prisma.recipe.findMany({
    where: { status: "published", kind: { in: ["plan", "prep"] }, ingredients: { some: { ingredientId: { in: [...prices.keys()] } } } },
    select: { slug: true, title: true, servings: true, ingredients: { select: { ingredientId: true, forUserId: true, grams: true } } },
  });
  return recipes
    .map((r) => ({ slug: r.slug, title: r.title, cost: mealCost(r.ingredients, r.servings, prices, people) }))
    .sort((a, b) => b.cost.priced / b.cost.lines - a.cost.priced / a.cost.lines || a.cost.perPortion - b.cost.perPortion);
}

export async function loadPurchases() {
  return prisma.purchase.findMany({
    orderBy: [{ boughtOn: "desc" }, { createdAt: "desc" }],
    include: { items: { orderBy: { sort: "asc" }, include: { ingredient: { select: { slug: true, nameEn: true } } } } },
  });
}

export function asKind(k: string): SpendKind {
  return k === "drink" || k === "household" ? k : "food";
}
