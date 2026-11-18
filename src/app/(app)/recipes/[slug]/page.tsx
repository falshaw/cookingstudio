import { notFound } from "next/navigation";
import Link from "next/link";
import { Clock, Download } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { recipeVM } from "@/lib/recipe-view";
import { RecipeBody } from "@/components/RecipeBody";
import { Chip, Pic } from "@/components/ui";
import { fmtMinutes } from "@/lib/utils";
import { clampServings } from "@/lib/scale";
import { prisma } from "@/lib/prisma";
import { FavButton } from "@/components/FavButton";
import { DislikeButton } from "@/components/DislikeButton";
import { viewerSauceLesson } from "@/lib/sauce-lesson";
import { recipeCost } from "@/lib/spending";
import { eur } from "@/lib/costs";

export default async function RecipePage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ servings?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = (await currentUser())!;
  const r = await recipeVM(slug, user.id);
  if (!r) notFound();
  const total = r.prepMinutes + r.cookMinutes;
  const hasSplit = r.lines.some((l) => l.component !== "both");
  const mine = hasSplit ? r.macros[user.slug === "sam" ? "sam" : "alex"] : r.macros.generic;
  const ingredientCount = new Set(r.lines.map((l) => l.ingredient.slug)).size;
  // Meal cost from receipt prices; null = nothing in it bought yet
  const cost = await recipeCost(r.id);
  const favs = await prisma.favourite.findMany({ where: { recipeId: r.id }, include: { user: { select: { id: true, name: true } } } });
  const partner = await prisma.user.findFirst({ where: { id: { not: user.id } }, select: { name: true, id: true } });
  const myDislike = await prisma.dislike.findUnique({ where: { userId_recipeId: { userId: user.id, recipeId: r.id } } });
  const draft = await prisma.recipe.findUnique({ where: { id: r.id }, select: { status: true } });
  const sauceLesson = await viewerSauceLesson(r.id, r.sauceLesson, user.id);
  return (
    <article>
      <div className="grid gap-5 md:grid-cols-[1.2fr_1fr] items-center mb-6">
        <Pic image={r.hero} alt={r.title} className="aspect-[4/3] w-full" />
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-clay-text">
            <Link href={`/path#level-${r.level}`}>Level {r.level}</Link>
            {r.sauceFamily && <> · <Link href="/sauces">Sauce School</Link></>}
          </p>
          <h1 className="font-display text-3xl font-bold mt-1">{r.title}</h1>
          <p className="mt-3 text-ink-soft">{r.description}</p>
          {/* Quick facts where you decide whether to cook it: YOUR portion, total time, ingredients. */}
          <dl className="mt-4 grid grid-cols-3 sm:grid-cols-5 gap-2 text-center" data-testid="quick-facts">
            {[
              { k: "Total", v: fmtMinutes(total) },
              { k: "Ingredients", v: String(ingredientCount) },
              { k: "kcal", v: String(Math.round(mine.kcal)) },
              { k: "Protein", v: `${Math.round(mine.protein)} g` },
              { k: "Net carbs", v: `${Math.round(mine.netCarbs)} g` },
            ].map((f) => (
              <div key={f.k} className="rounded-xl border border-line bg-white/60 px-2 py-2">
                <dt className="text-[10px] uppercase tracking-[0.14em] text-ink-muted">{f.k}</dt>
                <dd className="font-display text-lg font-bold tabular-nums">{f.v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1 text-[11px] text-ink-muted">{hasSplit ? `Your portion (${user.name})` : "Per portion"} · USDA data</p>
          {cost && (
            <p className="mt-1 text-sm" data-testid="meal-cost">
              <Link href="/spending" className="underline decoration-dotted">Cost per portion: {cost.complete ? eur(cost.perPortion) : `at least ${eur(cost.perPortion)}`}</Link>
              <span className="ml-1 text-xs text-ink-muted">({cost.priced} of {cost.lines} ingredients priced from our receipts)</span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <Chip><Clock size={13} /> {fmtMinutes(r.prepMinutes)} prep · {fmtMinutes(r.cookMinutes)} cook</Chip>
            {total > 30 && r.kind === "lesson" && <Chip tone="gold">Learning recipe · longer than 30 min</Chip>}
            {r.kind === "prep" && <Chip tone="sea">Meal prep · {r.servings} portions</Chip>}
            {r.equipment.map((e) => <Chip key={e} tone="neutral">{e.replace("-", " ")}</Chip>)}
          </div>
          {sauceLesson && (
            <Link href={`/recipes/${sauceLesson.slug}`} data-testid="sauce-lesson-link" className="mt-3 block glass-card p-3 text-sm hover:border-clay">
              <span className="text-[11px] font-semibold uppercase tracking-[0.22em] text-clay-text">The sauce in this dish</span>
              <span className="block font-semibold">{sauceLesson.title} → learn it in Sauce School</span>
            </Link>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <FavButton recipeId={r.id} initial={favs.some((f) => f.userId === user.id)} partnerName={partner?.name} partnerFav={favs.some((f) => f.userId === partner?.id)} />
            <DislikeButton recipeId={r.id} initial={{ on: !!myDislike, reason: myDislike?.reason ?? "" }} />
            {draft?.status === "draft" && <Chip tone="gold">Draft — approve it on Home</Chip>}
          </div>
          <a href={`/api/export?slug=${r.slug}`} className="mt-3 inline-flex items-center gap-1 text-sm text-sea-deep underline"><Download size={14} /> Export JSON</a>
        </div>
      </div>
      <RecipeBody r={r} initialServings={sp.servings ? clampServings(Number(sp.servings)) : undefined} />
    </article>
  );
}
