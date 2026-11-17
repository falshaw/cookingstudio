import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";

// Per-user 👎 on a recipe or an ingredient. on=false = undo.
const Body = z
  .object({
    recipeId: zId.optional(),
    ingredientId: zId.optional(),
    on: z.boolean(),
    reason: z.enum(["", "taste", "too long", "too hard", "ingredient"]).default(""),
  })
  .refine((b) => !!b.recipeId !== !!b.ingredientId, "give exactly one of recipeId or ingredientId");

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const { recipeId, ingredientId, on, reason } = r.body;
  if (recipeId && !(await prisma.recipe.findUnique({ where: { id: recipeId }, select: { id: true } }))) return bad("recipe not found", 404);
  if (ingredientId && !(await prisma.ingredient.findUnique({ where: { id: ingredientId }, select: { id: true } }))) return bad("ingredient not found", 404);
  const where = recipeId ? { userId: r.user.id, recipeId } : { userId: r.user.id, ingredientId };
  await prisma.dislike.deleteMany({ where });
  if (on) await prisma.dislike.create({ data: { ...where, reason } });
  return ok();
}
