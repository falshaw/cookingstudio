// "Sauce from my fridge": published Sauce School lessons whose ingredients are in stock (in/low) now,
// then the ones missing one ingredient. Water/salt/pepper/oil always count; the meat/fish a lesson cooks the sauce
// with is the dinner, not a sauce ingredient. Server component — used on /use-it-up and /sauces.
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { matchSauces } from "@/lib/sauce-ladder";
import { Chip } from "./ui";

export async function SauceFromFridge({ userId }: { userId: string }) {
  const [stock, lessons] = await Promise.all([
    prisma.stockItem.findMany({ where: { status: { in: ["in", "low"] } }, select: { ingredient: { select: { slug: true } } } }),
    prisma.recipe.findMany({
      where: { kind: "lesson", status: "published", sauceFamily: { not: null }, dislikes: { none: { userId } } },
      select: { id: true, slug: true, title: true, level: true, sauceFamily: true, ingredients: { select: { ingredient: { select: { slug: true, nameEn: true, isMeat: true, isFish: true } } } } },
    }),
  ]);
  const inStock = new Set(stock.map((s) => s.ingredient.slug));
  const { ready, oneShort } = matchSauces(lessons.map((l) => ({ ...l, lines: l.ingredients.map((i) => i.ingredient) })), inStock);
  return (
    <section className="glass-card p-4" data-testid="sauce-from-fridge">
      <h2 className="font-display text-lg font-semibold">Sauce from my fridge</h2>
      <p className="text-sm text-ink-muted mb-3">From what is in stock now. Water, salt, pepper and oil always count; the meat a sauce is cooked with is your dinner.</p>
      {ready.length === 0 && oneShort.length === 0 && <p className="text-sm text-ink-muted">Nothing matches the stock yet — update it on <Link href="/kitchen?tab=fridge" className="underline">Kitchen &amp; Stock</Link>.</p>}
      {ready.length > 0 && (
        <>
          <h3 className="text-sm font-semibold mb-1">You can make these now</h3>
          <ul className="grid gap-2 sm:grid-cols-2 mb-3" data-testid="sauce-ready">
            {ready.map(({ sauce, withProtein }) => (
              <li key={sauce.id} className="rounded-xl border border-line p-2 text-sm flex flex-wrap items-center gap-2">
                <Link href={`/recipes/${sauce.slug}`} className="font-semibold hover:underline flex-1">{sauce.title}</Link>
                {withProtein.length > 0 && <span className="text-xs text-ink-muted w-full">cooked with {withProtein.join(", ")}</span>}
                <Chip tone="olive">ready</Chip>
                <Link href={`/cook/${sauce.slug}?drill=1&servings=2`} className="text-xs underline text-clay-deep">practise it</Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {oneShort.length > 0 && (
        <>
          <h3 className="text-sm font-semibold mb-1">Missing 1 ingredient</h3>
          <ul className="grid gap-2 sm:grid-cols-2" data-testid="sauce-one-short">
            {oneShort.map(({ sauce, missing }) => (
              <li key={sauce.id} className="rounded-xl border border-line p-2 text-sm flex flex-wrap items-center gap-2">
                <Link href={`/recipes/${sauce.slug}`} className="font-semibold hover:underline flex-1">{sauce.title}</Link>
                <Chip tone="gold">need {missing[0]}</Chip>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
