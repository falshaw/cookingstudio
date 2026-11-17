import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { practiceMap } from "@/lib/practice";
import { PageHeader, Pic, Chip } from "@/components/ui";
import { SauceFromFridge } from "@/components/SauceFromFridge";
import { ladderRow, nextInFamily, RESCUE_TIPS, MASTER_RATING, MASTER_TIMES } from "@/lib/sauce-ladder";

const SAUCE_FAMILY_INFO: { key: string; title: string; blurb: string }[] = [
  { key: "quick", title: "Start here: quick sauces from the pan", blurb: "Six 5-minute sauces made from what is left in the pan or dish. Learn these first; every everyday recipe uses one of them." },
  { key: "mother", title: "Mother sauces & derivatives", blurb: "Béchamel, velouté, espagnole, tomato, hollandaise — and what you build on them." },
  { key: "pan", title: "Pan sauces", blurb: "Use the brown bits (fond) after searing: deglaze, reduce, finish." },
  { key: "emulsion", title: "Emulsions", blurb: "Fat and water held together: hollandaise, béarnaise, aioli, beurre blanc." },
  { key: "tomato", title: "Tomato family", blurb: "From a quick sauce to slow ragù." },
  { key: "blender", title: "Blender sauces", blurb: "Pesto, chimichurri, romesco, salsa verde, tahini, yogurt-dill." },
  { key: "bbq", title: "BBQ sauces", blurb: "Smoky, tangy, sugar-free." },
  { key: "mediterranean", title: "Mediterranean", blurb: "Egg-lemon, garlic-almond and lemon-oil sauces." },
  { key: "curry", title: "Curry bases", blurb: "Onion, ginger, garlic, spices — the base under every curry." },
];

const CORE = ["roux", "reduce", "emulsify", "starch-slurry", "deglaze", "stock"];

export default async function SaucesPage() {
  const user = (await currentUser())!;
  const [sauces, techniques, pm] = await Promise.all([
    prisma.recipe.findMany({ where: { sauceFamily: { not: null }, status: "published", dislikes: { none: { userId: user.id } } }, orderBy: { level: "asc" }, include: { hero: { select: { id: true, status: true, video: true } } } }),
    prisma.technique.findMany({ where: { slug: { in: CORE } }, include: { image: { select: { id: true, status: true } } } }),
    practiceMap(user.id),
  ]);
  const practised = sauces.filter((s) => pm.has(s.id)).length;
  // ladder: once a sauce is made ≥2× with a last rating ≥4, suggest the next one in its family
  const next = nextInFamily(sauces, pm);
  return (
    <div>
      <PageHeader eyebrow="Learn the sauces" title="Sauce School">
        Learn the six core moves first, then work through each family. You have practised {practised} of {sauces.length} sauces. A sauce made inside a dinner counts too. Make one {MASTER_TIMES}× with a {MASTER_RATING}/5 and the next one in its family is suggested.
      </PageHeader>
      <div className="mb-8"><SauceFromFridge userId={user.id} /></div>
      <section className="mb-8">
        <h2 className="font-display text-lg font-semibold mb-3">1 · The core techniques</h2>
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {CORE.map((slug) => {
            const t = techniques.find((x) => x.slug === slug);
            if (!t) return null;
            return (
              <Link key={slug} href={`/techniques/${slug}`} className="glass-card overflow-hidden">
                <Pic image={t.image} alt={t.title} className="aspect-square w-full" rounded="rounded-none" />
                <p className="p-2 text-sm font-semibold">{t.title}</p>
              </Link>
            );
          })}
        </div>
      </section>
      {SAUCE_FAMILY_INFO.map((f, idx) => {
        const list = sauces.filter((s) => s.sauceFamily === f.key);
        if (!list.length) return null;
        return (
          <section key={f.key} className="mb-8">
            <h2 className="font-display text-lg font-semibold">{idx + 2} · {f.title}</h2>
            <p className="text-sm text-ink-muted mb-3">{f.blurb}</p>
            {next.get(f.key) && (
              <p className="mb-3 text-sm rounded-xl border border-olive/40 bg-olive/5 p-2" data-testid="ladder-next">
                Ready for the next step: <Link href={`/recipes/${next.get(f.key)!.slug}`} className="font-semibold underline">{next.get(f.key)!.title}</Link>
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {list.map((s) => {
                const row = ladderRow(s, pm);
                const tip = s.level === 1 ? RESCUE_TIPS[s.slug] : undefined;
                return (
                  <div key={s.id} className="glass-card overflow-hidden flex flex-col" data-testid="sauce-card">
                    <Link href={`/recipes/${s.slug}`}>
                      <Pic image={s.hero} alt={s.title} className="aspect-[4/3] w-full" rounded="rounded-none" />
                    </Link>
                    <div className="p-3 flex-1 flex flex-col">
                      <Link href={`/recipes/${s.slug}`} className="font-semibold leading-tight hover:underline">{s.title}</Link>
                      <p className="text-xs text-ink-muted">{s.fridgeDays != null && `keeps ${s.fridgeDays} day${s.fridgeDays === 1 ? "" : "s"}`}{s.goesWith && ` · with ${s.goesWith.slice(0, 50)}`}</p>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {row.made ? (
                          <Chip tone={row.mastered ? "olive" : "sea"}>
                            made {row.made}×{row.lastRating != null && ` · last ${row.lastRating}/5`}{row.bestRating != null && row.bestRating !== row.lastRating && ` · best ${row.bestRating}/5`}
                          </Chip>
                        ) : <Chip>not made yet</Chip>}
                      </div>
                      {tip && <p className="mt-2 text-xs text-ink-soft" data-testid="rescue-tip"><strong>Rescue — {tip.problem.toLowerCase()}:</strong> {tip.fix}.</p>}
                      <Link href={`/cook/${s.slug}?drill=1&servings=2`} className="mt-auto pt-2 text-xs font-semibold underline text-clay-deep">Practise it on its own (2 portions)</Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
