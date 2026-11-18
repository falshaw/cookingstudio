import { prisma } from "@/lib/prisma";
import { PageHeader, Chip, Empty } from "@/components/ui";
import { RecipeCard } from "@/components/RecipeCard";
import { tasteFor } from "@/lib/taste";
import Link from "next/link";
import { HOUSEHOLD_ORDER } from "@/lib/household";

export default async function FavouritesPage() {
  const users = await prisma.user.findMany({ orderBy: HOUSEHOLD_ORDER, select: { id: true, name: true } });
  const favs = await prisma.favourite.findMany({ include: { recipe: { include: { hero: { select: { id: true, status: true, video: true } } } } } });
  const byRecipe = new Map<string, { recipe: (typeof favs)[number]["recipe"]; who: Set<string> }>();
  for (const f of favs) {
    const cur = byRecipe.get(f.recipeId) ?? { recipe: f.recipe, who: new Set<string>() };
    cur.who.add(f.userId);
    byRecipe.set(f.recipeId, cur);
  }
  const tastes = await Promise.all(users.map(async (u) => ({ u, t: await tasteFor(u.id) })));
  const list = [...byRecipe.values()].sort((a, b) => b.who.size - a.who.size);
  return (
    <div>
      <PageHeader eyebrow="What you love" title="Favourites & our taste">
        Hearts are per person; recipes everyone loves are weighted highest by the planner. The taste profile is worked out in code from favourites, ratings, how often you cook something, confidence, rejected drafts and your tweak notes — edit overrides on <Link href="/profiles" className="underline">Profiles</Link>.
      </PageHeader>
      {list.length === 0 ? (
        <Empty>No favourites yet — tap the heart on any recipe.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          {list.map(({ recipe, who }) => (
            <div key={recipe.id} className="relative">
              <RecipeCard r={recipe} />
              <div className="absolute top-2 left-2 flex gap-1">
                {who.size === users.length && users.length > 1 ? <Chip tone="gold" className="bg-paper">♥ {users.length === 2 ? "both love it" : "everyone loves it"}</Chip> : users.filter((u) => who.has(u.id)).map((u) => <Chip key={u.id} className="bg-paper">♥ {u.name}</Chip>)}
              </div>
            </div>
          ))}
        </div>
      )}
      <h2 className="font-display text-xl font-semibold mb-3">Our taste</h2>
      <div className="grid gap-4 md:grid-cols-2" data-testid="taste">
        {tastes.map(({ u, t }) => (
          <section key={u.id} className="glass-card p-4 text-sm space-y-2">
            <h3 className="font-display font-semibold text-lg">{u.name}</h3>
            {[["Cuisines", t.cuisines], ["Proteins", t.proteins], ["Sauce families", t.sauces], ["Techniques", t.techniques], ["Flavours", t.flavours]].map(([label, rows]) => (
              <p key={label as string}><strong>{label as string}:</strong> {(rows as [string, number][]).length ? (rows as [string, number][]).map(([k, v]) => `${k} (${v})`).join(", ") : <span className="text-ink-muted">not enough data yet</span>}</p>
            ))}
            <p><strong>Spice level:</strong> {t.spice} / 3</p>
            <p><strong>Seems to dislike:</strong> {[...t.overrides.dislikes, ...t.dislikes].join(", ") || <span className="text-ink-muted">nothing yet</span>}</p>
            {t.overrides.likes.length > 0 && <p><strong>Always liked (override):</strong> {t.overrides.likes.join(", ")}</p>}
            {t.tweakWords.length > 0 && <p><strong>From tweak notes:</strong> {t.tweakWords.join(", ")}</p>}
          </section>
        ))}
      </div>
    </div>
  );
}
