import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withScoped, zId } from "@/lib/api";

// "Add to shopping list" (gap-filling foods): one pack of the ingredient onto the newest list that is
// still open (≤ 7 days old with unticked items), or a new "Extras" list when there is none.
// Also by NAME (API keys with shopping:write): a known ingredient (English name, any case)
// is added as one pack; anything else becomes a free-text line in "Other" (no stock link).
export const OPEN_LIST_DAYS = 7;

const Body = z.union([z.object({ ingredientId: zId }), z.object({ name: z.string().trim().min(2).max(80) })]);

export async function POST(req: Request) {
  const r = await withScoped(req, Body, "shopping:write");
  if (r.error) return r.error;
  const b = r.body;
  const ing =
    "ingredientId" in b
      ? await prisma.ingredient.findUnique({ where: { id: b.ingredientId } })
      : await prisma.ingredient.findFirst({ where: { nameEn: { equals: b.name, mode: "insensitive" } } });
  if ("ingredientId" in b && !ing) return bad("ingredient not found", 404);
  const since = new Date(Date.now() - OPEN_LIST_DAYS * 86_400_000);
  const list =
    (await prisma.shoppingList.findFirst({ where: { createdAt: { gte: since }, items: { some: { checked: false } } }, orderBy: { createdAt: "desc" } })) ??
    (await prisma.shoppingList.create({ data: { name: "Extras", source: "recipes" } }));
  if (ing) {
    const exists = await prisma.shoppingItem.findFirst({ where: { listId: list.id, ingredientId: ing.id } });
    if (!exists) {
      await prisma.shoppingItem.create({ data: { listId: list.id, ingredientId: ing.id, name: ing.nameEn, qty: ing.packQty ?? 1, unit: ing.packUnit || "pack", section: ing.section, packNote: ing.packLabel ? `1 × ${ing.packLabel}` : "", sort: 9999 } });
    }
    return ok({ ok: true, listId: list.id, already: !!exists, name: ing.nameEn });
  }
  const name = (b as { name: string }).name;
  const exists = await prisma.shoppingItem.findFirst({ where: { listId: list.id, ingredientId: null, name: { equals: name, mode: "insensitive" } } });
  if (!exists) await prisma.shoppingItem.create({ data: { listId: list.id, ingredientId: null, name, qty: 1, unit: "", section: "other", sort: 9999 } });
  return ok({ ok: true, listId: list.id, already: !!exists, name, freeText: true });
}
