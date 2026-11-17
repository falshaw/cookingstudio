import Link from "next/link";
import { notFound } from "next/navigation";
import { Refrigerator, Snowflake, ShoppingBag, Repeat, Package, Info } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { Chip, Pic } from "@/components/ui";
import { SECTIONS } from "@/lib/shopping";
import { currentUser } from "@/lib/auth";
import { DislikeButton } from "@/components/DislikeButton";
import { matchesFood } from "@/lib/rules";

function Block({ icon: Icon, title, body }: { icon: typeof Info; title: string; body: string }) {
  if (!body) return null;
  return (
    <section className="glass-card p-4">
      <h2 className="font-display font-semibold mb-1 flex items-center gap-2"><Icon size={18} className="text-clay-deep" /> {title}</h2>
      <div className="text-ink-soft whitespace-pre-line">{body}</div>
    </section>
  );
}

export default async function IngredientPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const i = await prisma.ingredient.findUnique({
    where: { slug },
    include: { image: { select: { id: true, status: true } }, stock: true, uses: { include: { recipe: { select: { slug: true, title: true, status: true } } } } },
  });
  if (!i) notFound();
  const me = (await currentUser())!;
  const myDislike = await prisma.dislike.findUnique({ where: { userId_ingredientId: { userId: me.id, ingredientId: i.id } } });
  const profiles = await prisma.userProfile.findMany({ select: { avoidFoods: true, avoidExceptions: true, user: { select: { name: true } } } });
  const personNotes = profiles.flatMap((pr) => {
    const ex = (Array.isArray(pr.avoidExceptions) ? pr.avoidExceptions : []) as { allow: string; contexts: string[]; note?: string }[];
    const hit = ex.filter((e) => e.allow === i.slug).map((e) => e.note || `${pr.user.name}: only in ${e.contexts.join(" / ")}`);
    if (hit.length) return hit;
    return pr.avoidFoods.some((t) => matchesFood(i.slug, i.nameEn, t)) ? [`${pr.user.name}: avoids this`] : [];
  });
  const nut = i.fdcId ? await prisma.nutritionRef.findUnique({ where: { fdcId: i.fdcId } }) : null;
  const recipes = [...new Map(i.uses.filter((u) => u.recipe.status === "published").map((u) => [u.recipe.slug, u.recipe])).values()];
  const section = SECTIONS.find((s) => s.key === i.section);
  return (
    <article className="max-w-4xl">
      <div className="grid gap-5 sm:grid-cols-[220px_1fr] items-start mb-6">
        <Pic image={i.image} alt={i.nameEn} className="aspect-square w-full" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-clay-text">{section?.label ?? i.section}</p>
          <h1 className="font-display text-3xl font-bold">{i.nameEn}</h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {i.stock && <Chip tone={i.stock.status === "in" ? "olive" : i.stock.status === "low" ? "gold" : "red"}>stock: {i.stock.status}</Chip>}
            {i.isMeat && <Chip tone="clay">meat</Chip>}
            {i.isFish && <Chip tone="sea">fish</Chip>}
            {i.isOmega3 && <Chip tone="sea">oily fish (omega-3)</Chip>}
            {i.isRefinedStarch && <Chip tone="gold">refined starch</Chip>}
            {i.cardStatus === "pending" && <Chip>guide card being written</Chip>}
            {personNotes.map((n) => <Chip key={n} tone="gold">{n}</Chip>)}
          </div>
          <div className="mt-2"><DislikeButton ingredientId={i.id} initial={{ on: !!myDislike, reason: myDislike?.reason ?? "" }} /></div>
          {i.tastesLike && <p className="mt-3"><strong>Tastes like / used for:</strong> {i.tastesLike}</p>}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Block icon={Info} title="What it is" body={i.whatItIs} />
        <Block icon={ShoppingBag} title="Where to buy" body={i.buyTips} />
        <Block icon={Repeat} title="Substitutes" body={i.substitutes} />
        <Block icon={Package} title="Pack size in the shops" body={i.packLabel} />
        <section className="glass-card p-4 sm:col-span-2" data-testid="storage">
          <h2 className="font-display font-semibold mb-1 flex items-center gap-2"><Refrigerator size={18} className="text-clay-deep" /> Storage — waste less</h2>
          <div className="grid sm:grid-cols-3 gap-3 text-sm">
            <p><strong>Keep in:</strong> {i.storeWhere || "—"}</p>
            <p><strong>Keeps:</strong> {i.keepsDays != null ? `${i.keepsDays} days` : "—"}{i.keepsOpenedDays != null ? ` · opened: ${i.keepsOpenedDays} days` : ""}</p>
            <p className="flex items-start gap-1"><Snowflake size={15} className="mt-0.5" /> <span><strong>Freezer:</strong> {i.freezable ? `yes${i.freezerMonths ? `, up to ${i.freezerMonths} months` : ""}` : "no"}</span></p>
          </div>
          {i.storage && <p className="mt-2 text-ink-soft whitespace-pre-line">{i.storage}</p>}
          {i.freezeHow && <p className="mt-2 text-ink-soft"><strong>How to freeze:</strong> {i.freezeHow}</p>}
        </section>
        <section className="glass-card p-4">
          <h2 className="font-display font-semibold mb-1">Nutrition per 100 g</h2>
          {nut ? (
            <>
              <p className="text-sm tabular-nums">{Math.round(nut.kcal)} kcal · protein {nut.protein} g · carbs {nut.carbs} g{nut.fibre != null && ` (fibre ${nut.fibre} g)`} · fat {nut.fat} g{nut.sugar != null && ` · sugar ${nut.sugar} g`}</p>
              <p className="text-xs text-ink-muted mt-1">USDA FoodData Central SR Legacy #{nut.fdcId}: “{nut.name}”</p>
            </>
          ) : (
            <p className="text-sm text-ink-muted">No USDA match — recipes count it as unknown.</p>
          )}
        </section>
        <section className="glass-card p-4">
          <h2 className="font-display font-semibold mb-1">Used in</h2>
          {recipes.length ? (
            <ul className="text-sm space-y-1">{recipes.map((r) => <li key={r.slug}><Link className="underline text-clay-deep" href={`/recipes/${r.slug}`}>{r.title}</Link></li>)}</ul>
          ) : (
            <p className="text-sm text-ink-muted">Not in a recipe yet.</p>
          )}
        </section>
      </div>
    </article>
  );
}
