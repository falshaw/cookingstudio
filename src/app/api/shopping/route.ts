import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, publicError, withUser, zId } from "@/lib/api";
import { logError, requestIdOf } from "@/lib/log";
import { buildFromPlan, buildFromRecipes, daysLabel, saveList } from "@/lib/shopping-build";

const Body = z.discriminatedUnion("from", [
  z.object({ from: z.literal("recipes"), name: z.string().trim().max(300).transform((s) => (s.length > 80 ? `${s.slice(0, 79).trimEnd()}…` : s)).optional(), recipes: z.array(z.object({ recipeId: zId, servings: z.number().int().min(1).max(24) })).min(1).max(30) }),
  // days: 0 = Monday … 6 = Sunday of that plan week; missing = the whole week
  z.object({ from: z.literal("plan"), planId: zId, days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional() }),
]);

/** "2026-10-19 18:42" — makes list names unique and recognisable. */
const stamp = () => new Date().toISOString().slice(0, 16).replace("T", " ");

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  try {
    if (r.body.from === "recipes") {
      const { items, leftOut } = await buildFromRecipes(r.body.recipes);
      const list = await saveList(r.body.name || `Shopping ${stamp()}`, "recipes", items);
      return ok({ ok: true, id: list.id, name: list.name, items, leftOut });
    }
    const plan = await prisma.mealPlan.findUnique({ where: { id: r.body.planId } });
    if (!plan) return bad("plan not found", 404);
    const days = r.body.days ? [...new Set(r.body.days)].sort((a, b) => a - b) : undefined;
    const { items, leftOut } = await buildFromPlan(plan.id, days);
    const part = daysLabel(days);
    const list = await saveList(`Week of ${plan.weekStart.toISOString().slice(0, 10)}${part ? ` · ${part}` : ""} · ${stamp().slice(11)}`, "plan", items);
    return ok({ ok: true, id: list.id, leftOut });
  } catch (e) {
    logError("shopping list build failed", { requestId: requestIdOf(req), err: e });
    return bad(publicError(e), 500);
  }
}

export async function DELETE(req: Request) {
  const r = await withUser(req, z.object({ id: zId }));
  if (r.error) return r.error;
  await prisma.shoppingList.deleteMany({ where: { id: r.body.id } });
  return ok();
}
