import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";

const Body = z.discriminatedUnion("action", [
  // freshTonight: freezer-sauce batch — cook `portions`, eat this many the same night (counted as eaten), freeze the rest
  z.object({ action: z.literal("create"), recipeId: zId, portions: z.number().int().min(1).max(24), freshTonight: z.number().int().min(0).max(23).default(0) }),
  z.object({ action: z.literal("cooked"), id: zId, location: z.enum(["fridge", "freezer"]).default("fridge") }),
  z.object({ action: z.literal("eat"), id: zId, portions: z.number().int().min(1).max(24).default(1) }),
  z.object({ action: z.literal("move"), id: zId, location: z.enum(["fridge", "freezer"]) }),
  z.object({ action: z.literal("delete"), id: zId }),
]);

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const b = r.body;
  if (b.action === "create") {
    const rec = await prisma.recipe.findUnique({ where: { id: b.recipeId } });
    if (!rec) return bad("recipe not found", 404);
    if (b.freshTonight >= b.portions) return bad("nothing left to freeze", 400);
    const row = await prisma.prepBatch.create({ data: { recipeId: rec.id, portions: b.portions, eaten: b.freshTonight } });
    return ok({ ok: true, id: row.id });
  }
  const batch = await prisma.prepBatch.findUnique({ where: { id: b.id } });
  if (!batch) return bad("batch not found", 404);
  if (b.action === "cooked") await prisma.prepBatch.update({ where: { id: batch.id }, data: { cookedAt: new Date(), location: b.location } });
  if (b.action === "eat") await prisma.prepBatch.update({ where: { id: batch.id }, data: { eaten: Math.min(batch.portions, batch.eaten + b.portions) } });
  if (b.action === "move") await prisma.prepBatch.update({ where: { id: batch.id }, data: { location: b.location } });
  if (b.action === "delete") await prisma.prepBatch.delete({ where: { id: batch.id } });
  return ok();
}
