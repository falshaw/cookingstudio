import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/ui";
import { KitchenStock } from "@/components/KitchenStock";

export default async function KitchenPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab = "equipment" } = await searchParams;
  const [equipment, ingredients, batches] = await Promise.all([
    prisma.equipment.findMany({ orderBy: [{ category: "asc" }, { sort: "asc" }] }),
    prisma.ingredient.findMany({ orderBy: { nameEn: "asc" }, include: { stock: true } }),
    prisma.prepBatch.findMany({ where: { cookedAt: { not: null } }, include: { recipe: { select: { title: true, slug: true, fridgeDays: true, freezerDays: true } } }, orderBy: { cookedAt: "desc" } }),
  ]);
  return (
    <div>
      <PageHeader eyebrow="Household" title="Kitchen & Stock">
        Tick the kit you own. Track spices, pantry, fridge and freezer with one tap — low or out items go onto the next shopping list.
      </PageHeader>
      <KitchenStock
        initialTab={tab}
        equipment={equipment}
        ingredients={ingredients.map((i) => ({
          id: i.id,
          slug: i.slug,
          nameEn: i.nameEn,
          
          
          kind: i.kind,
          buyTips: i.buyTips,
          tastesLike: i.tastesLike,
          keepsDays: i.keepsDays,
          freezerMonths: i.freezerMonths,
          stock: i.stock ? { status: i.stock.status, location: i.stock.location, qty: i.stock.qty, bestBefore: i.stock.bestBefore?.toISOString().slice(0, 10) ?? null, frozenAt: i.stock.frozenAt?.toISOString().slice(0, 10) ?? null } : null,
        }))}
        batches={batches.map((b) => ({
          id: b.id,
          title: b.recipe.title,
          slug: b.recipe.slug,
          location: b.location,
          portionsLeft: b.portions - b.eaten,
          cookedAt: b.cookedAt!.toISOString().slice(0, 10),
          keepsDays: b.location === "freezer" ? b.recipe.freezerDays ?? 90 : b.recipe.fridgeDays ?? 3,
        }))}
      />
    </div>
  );
}
