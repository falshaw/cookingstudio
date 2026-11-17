import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";
import { isRealDay } from "@/lib/utils";

const Body = z.object({
  ingredientId: zId,
  status: z.enum(["in", "low", "out"]).optional(),
  location: z.enum(["spices", "pantry", "fridge", "freezer"]).optional(),
  qty: z.string().max(40).optional(),
  bestBefore: z.string().refine(isRealDay, "not a real date").nullable().optional(),
  frozenAt: z.string().refine(isRealDay, "not a real date").nullable().optional(),
  remove: z.boolean().optional(),
});

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const b = r.body;
  const ing = await prisma.ingredient.findUnique({ where: { id: b.ingredientId }, select: { id: true, kind: true } });
  if (!ing) return bad("ingredient not found", 404);
  if (b.remove) {
    await prisma.stockItem.deleteMany({ where: { ingredientId: ing.id } });
    return ok();
  }
  const date = (s: string | null | undefined) => (s === undefined ? undefined : s === null ? null : new Date(`${s}T00:00:00Z`));
  const data = {
    status: b.status,
    location: b.location,
    qty: b.qty,
    bestBefore: date(b.bestBefore),
    frozenAt: b.location === "freezer" && b.frozenAt === undefined ? new Date() : date(b.frozenAt),
  };
  const row = await prisma.stockItem.upsert({
    where: { ingredientId: ing.id },
    create: { ingredientId: ing.id, status: b.status ?? "in", location: b.location ?? (ing.kind === "spice" || ing.kind === "herb" ? "spices" : "pantry"), qty: b.qty ?? "", bestBefore: data.bestBefore ?? null, frozenAt: data.frozenAt ?? null },
    update: Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)),
  });
  return ok({ ok: true, item: row });
}
