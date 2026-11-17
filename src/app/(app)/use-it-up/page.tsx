import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { serverNow } from "@/lib/utils";
import { PageHeader, Chip } from "@/components/ui";
import { TeachForm } from "@/components/TeachForm";
import { compLines, loadProfiles, nutritionMap, recipeMacros, ruleLines, toRuleProfile } from "@/lib/recipe-data";
import { checkPortion } from "@/lib/rules";
import { currentUser } from "@/lib/auth";
import { SauceFromFridge } from "@/components/SauceFromFridge";

export default async function UseItUpPage({ searchParams }: { searchParams: Promise<{ use?: string | string[] }> }) {
  const sp = await searchParams;
  const picked = new Set((Array.isArray(sp.use) ? sp.use : sp.use ? [sp.use] : []).filter(Boolean));
  const stock = await prisma.stockItem.findMany({ where: { status: { not: "out" } }, include: { ingredient: true }, orderBy: [{ bestBefore: "asc" }] });
  const soon = serverNow() + 3 * 86_400_000;
  const me = (await currentUser())!;
  const myDislikes = (await prisma.dislike.findMany({ where: { userId: me.id, recipeId: { not: null } }, select: { recipeId: true } })).map((d) => d.recipeId!);
  const ranked = picked.size
    ? await prisma.recipe.findMany({
        where: { status: "published", id: { notIn: myDislikes }, ingredients: { some: { ingredientId: { in: [...picked] } } } },
        include: { ingredients: { include: { ingredient: true } } },
      })
    : [];
  const users = await loadProfiles();
  const nut = await nutritionMap(ranked.flatMap((r) => r.ingredients.map((i) => i.ingredient.fdcId)));
  const results = ranked
    .map((r) => {
      const uses = [...new Set(r.ingredients.filter((i) => picked.has(i.ingredientId)).map((i) => i.ingredient.nameEn))];
      const m = recipeMacros(r.servings, compLines(r.ingredients, nut));
      const fails = users.flatMap((u) =>
        checkPortion(r.kind === "lesson" ? { ...toRuleProfile(u), maxNetCarbsPerMeal: null, minProteinPerMeal: null, vegetarian: false } : toRuleProfile(u), {
          title: r.title,
          meal: "dinner",
          totalMinutes: r.prepMinutes + r.cookMinutes,
          precooked: r.kind !== "plan",
          lines: ruleLines(r.ingredients),
          context: { title: r.title, cuisine: r.cuisine, tags: r.flavourTags, sauceFamily: r.sauceFamily },
          macros: u.slug === "alex" ? m.alex : m.sam,
        }).filter((i) => i.level === "fail"),
      );
      return { r, uses, fails };
    })
    .sort((a, b) => b.uses.length - a.uses.length || a.fails.length - b.fails.length);
  const pickedNames = stock.filter((s) => picked.has(s.ingredientId)).map((s) => s.ingredient.nameEn);
  return (
    <div className="max-w-5xl">
      <PageHeader eyebrow="Waste less" title="Use it up">
        Tick what needs using (items close to their best-before are first), and see which recipes use them — with the household rule check. Or ask the local AI for a new idea.
      </PageHeader>
      <div className="mb-4"><SauceFromFridge userId={me.id} /></div>
      <form className="glass-card p-4">
        {stock.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing in stock yet — add fridge items on <Link href="/kitchen?tab=fridge" className="underline">Kitchen & Stock</Link>.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {stock.map((s) => {
              const urgent = s.bestBefore && s.bestBefore.getTime() <= soon;
              return (
                <label key={s.ingredientId} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm cursor-pointer ${urgent ? "border-clay/40 bg-clay/5" : "border-line"}`}>
                  <input type="checkbox" name="use" value={s.ingredientId} defaultChecked={picked.has(s.ingredientId)} />
                  {s.ingredient.nameEn}
                  {urgent && <span className="text-[11px] text-clay-deep">use by {s.bestBefore!.toISOString().slice(5, 10)}</span>}
                </label>
              );
            })}
          </div>
        )}
        <button className="btn-primary mt-3">Find recipes</button>
      </form>

      {picked.size > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold mb-2">Recipes that use them</h2>
          {results.length === 0 ? (
            <p className="text-sm text-ink-muted">No recipe in the library uses these yet — ask the local AI below.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2" data-testid="use-results">
              {results.map(({ r, uses, fails }) => (
                <li key={r.id} className="glass-card p-3 text-sm">
                  <Link href={`/recipes/${r.slug}`} className="font-semibold hover:underline">{r.title}</Link>
                  <p className="text-ink-soft">uses {uses.join(", ")}</p>
                  {fails.length ? <p className="text-clay-deep text-xs mt-1">{fails[0].msg}{fails.length > 1 && ` (+${fails.length - 1} more)`}</p> : <Chip tone="olive">fits both profiles</Chip>}
                </li>
              ))}
            </ul>
          )}
          <h2 className="font-display text-lg font-semibold mt-6 mb-2">New idea from the local AI</h2>
          <TeachForm initialDish={`a quick recipe that uses up ${pickedNames.join(", ")}`} />
        </section>
      )}
    </div>
  );
}
