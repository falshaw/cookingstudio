import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";
import { planVariant, swapFor } from "@/lib/swaps";
import { loadProfiles, toRuleProfile } from "@/lib/recipe-data";
import { logInfo, requestIdOf } from "@/lib/log";

// One-click per-person variant: swaps one ingredient in ONE person's portion (everyone else keeps the
// original). Rewrites the recipe lines and notes the change on the recipe. `who` = that person's user id.
const Body = z.object({ lineId: zId, who: zId });

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const line = await prisma.recipeIngredient.findUnique({ where: { id: r.body.lineId }, include: { ingredient: true, recipe: true } });
  if (!line) return bad("ingredient line not found", 404);
  if (line.forUserId != null && line.forUserId !== r.body.who) return bad("that line is not in this person's portion");
  const users = await loadProfiles();
  const person = users.find((u) => u.id === r.body.who);
  if (!person) return bad("person not found", 404);
  const swap = swapFor(toRuleProfile(person), line.ingredient.slug);
  if (!swap) return bad("no swap that fits this person's avoid list", 404);
  const plan = planVariant(line, swap, person.id, line.recipe.servings, users.map((u) => u.id));
  const target = swap.to ? await prisma.ingredient.findUnique({ where: { slug: swap.to } }) : null;
  if (swap.to && !target) return bad("swap ingredient missing from the guide", 500);
  await prisma.$transaction(async (tx) => {
    await tx.recipeIngredient.delete({ where: { id: line.id } });
    for (const k of plan.keepFor) {
      await tx.recipeIngredient.create({ data: { recipeId: line.recipeId, ingredientId: line.ingredientId, forUserId: k.forUserId, grams: k.grams, qty: k.qty, unit: line.unit, prep: line.prep, sort: line.sort } });
    }
    if (plan.added && target) await tx.recipeIngredient.create({ data: { recipeId: line.recipeId, ingredientId: target.id, forUserId: plan.added.forUserId, grams: plan.added.grams, qty: plan.added.qty, unit: plan.added.unit, prep: "", sort: line.sort } });
    const note = `${person.name}: ${target ? `${target.nameEn} instead of ${line.ingredient.nameEn}` : `no ${line.ingredient.nameEn}`} (${swap.note}).`;
    await tx.recipe.update({ where: { id: line.recipeId }, data: { variantNote: [line.recipe.variantNote, note].filter(Boolean).join(" ") } });
  });
  logInfo("per-person variant applied", { requestId: requestIdOf(req), recipeId: line.recipeId, who: person.slug, from: line.ingredient.slug, to: swap.to });
  return ok();
}
