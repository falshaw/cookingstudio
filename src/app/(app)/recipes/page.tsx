import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { practiceMap } from "@/lib/practice";
import { recipeScores } from "@/lib/recipe-scores";
import { DislikeButton } from "@/components/DislikeButton";
import { RecipeCard } from "@/components/RecipeCard";
import { PageHeader, Empty } from "@/components/ui";
import { Search } from "lucide-react";
import type { Prisma } from "@prisma/client";

const KINDS = [
  ["", "All"],
  ["lesson", "Lessons"],
  ["plan", "Weeknight (plan)"],
  ["prep", "Meal prep"],
] as const;

export default async function RecipesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const user = (await currentUser())!;
  const q = (sp.q ?? "").trim();
  const where: Prisma.RecipeWhereInput = { status: "published" };
  if (q) where.OR = [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }];
  if (sp.kind) where.kind = sp.kind;
  if (sp.level) where.level = Number(sp.level);
  if (sp.equip) where.equipment = { has: sp.equip };
  const [recipes, equipment, pm] = await Promise.all([
    prisma.recipe.findMany({ where, orderBy: [{ level: "asc" }, { title: "asc" }], include: { hero: { select: { id: true, status: true, video: true } } } }),
    prisma.equipment.findMany({ orderBy: { sort: "asc" } }),
    practiceMap(user.id),
  ]);
  const scores = await recipeScores(recipes.map((r) => r.id), user.id);
  const mine = new Map((await prisma.dislike.findMany({ where: { userId: user.id, recipeId: { not: null } } })).map((d) => [d.recipeId!, d.reason]));
  const missingKit = new Set(equipment.filter((e) => !e.have).map((e) => e.slug));
  const canCook = sp.mykit === "1" ? recipes.filter((r) => r.equipment.every((e) => !missingKit.has(e))) : recipes;
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/recipes?${p}`;
  };
  return (
    <div>
      <PageHeader eyebrow="Library" title="Recipes">
        Every recipe is open — start anywhere.
      </PageHeader>
      <form className="relative mb-4 max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" size={18} />
        <input name="q" defaultValue={q} placeholder="Search: risotto, curry, sauce…" className="input-field pl-10" />
        {sp.kind && <input type="hidden" name="kind" value={sp.kind} />}
      </form>
      <div className="flex flex-wrap gap-2 mb-3">
        {KINDS.map(([k, label]) => (
          <Link key={k} href={href({ kind: k })} className={`rounded-full border px-3 py-1 text-sm ${(sp.kind ?? "") === k ? "bg-clay/10 border-clay/30 text-clay-deep" : "border-line text-ink-soft"}`}>{label}</Link>
        ))}
        <Link href={href({ mykit: sp.mykit === "1" ? "" : "1" })} className={`rounded-full border px-3 py-1 text-sm ${sp.mykit === "1" ? "bg-olive/10 border-olive/30 text-olive" : "border-line text-ink-soft"}`}>Only with my kit</Link>
      </div>
      <div className="flex flex-wrap gap-2 mb-6 text-sm">
        <span className="text-ink-muted">Needs:</span>
        {["slow-cooker", "air-fryer", "blender", "oven", "mixer", "food-processor"].map((e) => (
          <Link key={e} href={href({ equip: sp.equip === e ? "" : e })} className={`rounded-full border px-2.5 py-0.5 ${sp.equip === e ? "bg-sea/10 border-sea/30 text-sea-deep" : "border-line text-ink-soft"}`}>{e.replace("-", " ")}</Link>
        ))}
        {[1, 2, 3, 4, 5, 6, 7, 8].map((l) => (
          <Link key={l} href={href({ level: sp.level === String(l) ? "" : String(l) })} className={`rounded-full border px-2.5 py-0.5 ${sp.level === String(l) ? "bg-clay/10 border-clay/30 text-clay-deep" : "border-line text-ink-soft"}`}>L{l}</Link>
        ))}
      </div>
      {canCook.length === 0 ? (
        <Empty>No recipe matches. Try another word, or ask <Link className="text-clay-deep underline" href="/teach">Teach me</Link>.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {canCook.map((r) => {
            const p = pm.get(r.id);
            return (
              <div key={r.id} className="flex flex-col gap-1">
                <RecipeCard r={{ ...r, cookedCount: p?.count, confidence: p?.confidence, score: scores.get(r.id) ?? null, disliked: mine.has(r.id) }} />
                {mine.has(r.id) && <DislikeButton recipeId={r.id} initial={{ on: true, reason: mine.get(r.id) ?? "" }} compact />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
