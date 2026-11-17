import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { ShoppingClient } from "@/components/ShoppingClient";
import { weekStart } from "@/lib/utils";

export default async function ShoppingPage({ searchParams }: { searchParams: Promise<{ add?: string; servings?: string; list?: string }> }) {
  const sp = await searchParams;
  const [recipes, lists, plan] = await Promise.all([
    prisma.recipe.findMany({ where: { status: "published" }, orderBy: { title: "asc" }, select: { id: true, slug: true, title: true, servings: true } }),
    prisma.shoppingList.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { items: { orderBy: { sort: "asc" } } } }),
    prisma.mealPlan.findUnique({ where: { weekStart: weekStart(new Date()) }, select: { id: true, weekStart: true } }),
  ]);
  const pre = sp.add ? recipes.find((r) => r.slug === sp.add) : undefined;
  return (
    <div>
      <PageHeader eyebrow="One list, by aisle" title="Shopping list">
        Pick recipes (or this week&apos;s plan) and get one merged list by aisle. Ticks are saved, so you can shop together from two phones.
      </PageHeader>
      <ShoppingClient
        recipes={recipes}
        preselect={pre ? { recipeId: pre.id, servings: Number(sp.servings) || pre.servings } : null}
        planId={plan?.id ?? null}
        initialListId={sp.list ?? lists[0]?.id ?? null}
        lists={lists.map((l) => ({ id: l.id, name: l.name, createdAt: l.createdAt.toISOString(), items: l.items.map((i) => ({ id: i.id, name: i.name, qty: i.qty, unit: i.unit, section: i.section, forWho: i.forWho, inPantry: i.inPantry, packNote: i.packNote, avoidNote: i.avoidNote, checked: i.checked, ingredientId: i.ingredientId, stockAdded: i.stockUndo !== null, stockUntil: (i.stockUndo as { wrote?: { bestBefore?: string | null } } | null)?.wrote?.bestBefore ?? null })) }))}
      />
    </div>
  );
}
