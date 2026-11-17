import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";
import { planVariant, swapFor } from "@/lib/swaps";
import { loadProfiles, toRuleProfile } from "@/lib/recipe-data";
import { logInfo, requestIdOf } from "@/lib/log";

// One-click per-person variant: swaps one ingredient in ONE person's portion (the other person
// keeps the original). Rewrites the recipe lines and notes the change on the recipe.
const Body = z.object({ lineId: zId, who: z.enum(["alex", "sam"]) });

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const line = await prisma.recipeIngredient.findUnique({ where: { id: r.body.lineId }, include: { ingredient: true, recipe: true } });
  if (!line) return bad("ingredient line not found", 404);
  if (line.component !== "both" && line.component !== r.body.who) return bad("that line is not in this person's portion");
  const person = (await loadProfiles()).find((u) => u.slug === r.body.who);
  if (!person) return bad("person not found", 404);
  const swap = swapFor(toRuleProfile(person), line.ingredient.slug);
  if (!swap) return bad("no swap that fits this person's avoid list", 404);
  const plan = planVariant(line, swap, r.body.who, line.recipe.servings);
  const target = swap.to ? await prisma.ingredient.findUnique({ where: { slug: swap.to } }) : null;
  if (swap.to && !target) return bad("swap ingredient missing from the guide", 500);
  const name = r.body.who === "alex" ? "Alex" : "Sam";
  await prisma.$transaction(async (tx) => {
    if (plan.original) await tx.recipeIngredient.update({ where: { id: line.id }, data: plan.original });
    else await tx.recipeIngredient.delete({ where: { id: line.id } });
    if (plan.added && target) await tx.recipeIngredient.create({ data: { recipeId: line.recipeId, ingredientId: target.id, component: plan.added.component, grams: plan.added.grams, qty: plan.added.qty, unit: plan.added.unit, prep: "", sort: line.sort } });
    const note = `${name}: ${target ? `${target.nameEn} instead of ${line.ingredient.nameEn}` : `no ${line.ingredient.nameEn}`} (${swap.note}).`;
    await tx.recipe.update({ where: { id: line.recipeId }, data: { variantNote: [line.recipe.variantNote, note].filter(Boolean).join(" ") } });
  });
  logInfo("per-person variant applied", { requestId: requestIdOf(req), recipeId: line.recipeId, who: r.body.who, from: line.ingredient.slug, to: swap.to });
  return ok();
}
