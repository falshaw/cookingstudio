import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";

const Body = z.object({
  recipeId: zId,
  rating: z.number().int().min(1).max(5),
  confidence: z.number().int().min(1).max(5),
  notes: z.string().max(2000).default(""),
  tweak: z.string().max(300).default(""),
  cookedAt: z.string().datetime().optional(),
  // the dish's sauce lesson is credited as practised (default on); its own 1–5 rating
  sauceCredit: z.boolean().default(true),
  sauceRating: z.number().int().min(1).max(5).optional(),
});

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const recipe = await prisma.recipe.findUnique({ where: { id: r.body.recipeId }, select: { id: true, slug: true, sauceLesson: true } });
  if (!recipe) return bad("recipe not found", 404);
  // the lesson comes from the recipe row, never from the client; only a published lesson other than the dish itself
  const lesson = r.body.sauceCredit && recipe.sauceLesson && recipe.sauceLesson !== recipe.slug
    ? await prisma.recipe.findFirst({ where: { slug: recipe.sauceLesson, status: "published", kind: "lesson" }, select: { slug: true } })
    : null;
  const row = await prisma.cookLog.create({
    data: { userId: r.user.id, recipeId: recipe.id, rating: r.body.rating, confidence: r.body.confidence, notes: r.body.notes, tweak: r.body.tweak, sauceLessonSlug: lesson?.slug ?? null, sauceRating: lesson ? r.body.sauceRating ?? null : null, cookedAt: r.body.cookedAt ? new Date(r.body.cookedAt) : undefined },
  });
  return ok({ ok: true, id: row.id, sauceCredit: lesson?.slug ?? null });
}

export async function DELETE(req: Request) {
  const r = await withUser(req, z.object({ id: zId }));
  if (r.error) return r.error;
  await prisma.cookLog.deleteMany({ where: { id: r.body.id, userId: r.user.id } });
  return ok();
}
