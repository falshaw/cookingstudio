// "The sauce in this dish → learn it" link for one viewer: never a lesson the viewer 👎'd —
// then the closest liked lesson of the same family (pickSauceLesson), or no link.
import { prisma } from "./prisma";
import { pickSauceLesson } from "./sauce-rule";

export async function viewerSauceLesson(recipeId: string, wanted: string | null, userId: string): Promise<{ slug: string; title: string } | null> {
  if (!wanted) return null;
  const linked = await prisma.recipe.findFirst({ where: { slug: wanted, status: "published", sauceFamily: { not: null } }, select: { sauceFamily: true } });
  if (!linked) return null;
  const options = await prisma.recipe.findMany({
    where: { status: "published", sauceFamily: linked.sauceFamily },
    select: { slug: true, title: true, sauceFamily: true, level: true, ingredients: { select: { ingredientId: true } } },
  });
  const disliked = await prisma.dislike.findMany({ where: { userId, recipe: { sauceFamily: linked.sauceFamily } }, select: { recipe: { select: { slug: true } } } });
  const dish = await prisma.recipeIngredient.findMany({ where: { recipeId }, select: { ingredientId: true } });
  const pick = pickSauceLesson(
    wanted,
    options.map((o) => ({ slug: o.slug, title: o.title, sauceFamily: o.sauceFamily, level: o.level, ingredientIds: o.ingredients.map((i) => i.ingredientId) })),
    new Set(disliked.map((d) => d.recipe?.slug).filter((s): s is string => !!s)),
    dish.map((d) => d.ingredientId),
  );
  return pick ? { slug: pick.slug, title: pick.title } : null;
}
