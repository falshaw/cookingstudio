import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, withUser, zId } from "@/lib/api";

export async function POST(req: Request) {
  const r = await withUser(req, z.object({ recipeId: zId, on: z.boolean() }));
  if (r.error) return r.error;
  const key = { userId_recipeId: { userId: r.user.id, recipeId: r.body.recipeId } };
  if (r.body.on) await prisma.favourite.upsert({ where: key, create: { userId: r.user.id, recipeId: r.body.recipeId }, update: {} });
  else await prisma.favourite.deleteMany({ where: { userId: r.user.id, recipeId: r.body.recipeId } });
  return ok();
}
