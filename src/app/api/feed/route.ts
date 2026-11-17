import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";

// Approve a drafted recipe into the library, or reject it with a reason (fed to the next generation).
const Body = z.object({ recipeId: zId, decision: z.enum(["approve", "reject"]), reason: z.string().max(300).optional() });

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const rec = await prisma.recipe.findUnique({ where: { id: r.body.recipeId } });
  if (!rec || rec.status !== "draft") return bad("not a draft", 404);
  if (r.body.decision === "approve") await prisma.recipe.update({ where: { id: rec.id }, data: { status: "published" } });
  else await prisma.recipe.update({ where: { id: rec.id }, data: { status: "rejected", rejectReason: r.body.reason?.trim() || "not for us" } });
  return ok();
}
