import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader, Pic, Chip } from "@/components/ui";
import { PrepClient, PrepAction, SauceBatchClient } from "@/components/PrepClient";
import { cookTogether } from "@/lib/cooking";
import { weekStart, serverNow } from "@/lib/utils";
import { loadCandidates, slotIssues } from "@/lib/planner";
import { loadProfiles, toRuleProfile } from "@/lib/recipe-data";
import { FREEZER_SAUCE_WHERE } from "@/lib/sauce-ladder";

export default async function PrepPage() {
  const ws = weekStart(new Date());
  const [prepRecipes, sauces, batches, plan] = await Promise.all([
    prisma.recipe.findMany({ where: { kind: "prep", status: "published" }, orderBy: { title: "asc" }, include: { hero: { select: { id: true, status: true, video: true } } } }),
    // freezer sauces = real Sauce School sauces (sauceFamily set) that keep in the freezer — not rice, roasts or stocks
    prisma.recipe.findMany({ where: { ...FREEZER_SAUCE_WHERE, status: "published" }, orderBy: { title: "asc" }, select: { id: true, slug: true, title: true } }),
    prisma.prepBatch.findMany({ orderBy: { createdAt: "desc" }, take: 30, include: { recipe: { include: { steps: { orderBy: { n: "asc" } } } }, slots: true } }),
    prisma.mealPlan.findUnique({ where: { weekStart: ws }, select: { id: true } }),
  ]);
  // flag sauces someone can't eat (avoid list, vegetarian…) — the plan never uses those portions for them
  const users = await loadProfiles();
  const people = users.map(toRuleProfile);
  const sauceCands = new Map((await loadCandidates({ alex: 1, sam: 1 })).filter((c) => c.kind === "lesson").map((c) => [c.id, c]));
  const sauceOptions = sauces.map((r) => {
    const c = sauceCands.get(r.id);
    const fails = c ? slotIssues(c, "dinner", people, true, true).filter((i) => i.level === "fail") : [];
    const who = [...new Set(fails.map((i) => people.find((p) => p.slug === i.who)?.name ?? i.who))];
    const terms = [...new Set(fails.map((i) => i.msg.match(/\(([^)]+)\)$/)?.[1]).filter(Boolean))];
    return { id: r.id, slug: r.slug, title: who.length ? `${r.title} — not for ${who.join(" & ")}${terms.length ? ` (${terms.join(", ")})` : ""}` : r.title };
  });
  const session = batches.filter((b) => !b.cookedAt);
  // Prep-session timeline: longest-cooking batch first (oven / slow cooker start early), all steps on two lanes.
  const ordered = [...session].sort((a, b) => b.recipe.cookMinutes - a.recipe.cookMinutes);
  const steps = ordered.flatMap((b, bi) => b.recipe.steps.map((s) => ({ n: bi * 100 + s.n, who: s.who, minutes: s.minutes, text: `${b.recipe.title}: ${s.text}` })));
  const timeline = cookTogether(steps);
  const today = serverNow();
  return (
    <div>
      <PageHeader eyebrow="Cook once, eat for days" title="Meal prep">
        Plan a prep session (e.g. Sunday, ~2 h), follow one timeline for both of you, then track portions left in the fridge and freezer. Prepped portions fill meals on the plan.
      </PageHeader>

      <section className="mb-6">
        <h2 className="font-display text-lg font-semibold mb-1">Freezer sauces — cook once, eat fresh, freeze the rest</h2>
        <p className="text-sm text-ink-muted mb-3">Cook a big pot of one sauce (e.g. for 6), eat 2 portions the same night, freeze 4 single portions. Later you only cook the fresh part — pasta, rice, meat or veg — and heat the sauce.</p>
        <details className="glass-card p-4 mb-3 text-sm" data-testid="freeze-guide">
          <summary className="font-semibold cursor-pointer">First time? How to freeze sauce safely</summary>
          <ol className="mt-2 list-decimal pl-5 space-y-1">
            <li><strong>Cook the full batch.</strong> Open the recipe from the batch below — it is already scaled to the portions you cook, and its WhatsApp button sends the shopping list.</li>
            <li><strong>Serve tonight&apos;s portions first,</strong> straight from the pot.</li>
            <li><strong>Cool the rest fast:</strong> spread it in a wide, shallow dish, lid off, and get it into the fridge within 2 hours of cooking. Never leave it on the stove overnight.</li>
            <li><strong>One portion per bag or tub:</strong> zip-lock freezer bags or small tubs. Press the air out and freeze bags flat — they stack and thaw quicker.</li>
            <li><strong>Label each one:</strong> sauce name + date (a marker on the bag). The app below counts down how long it keeps.</li>
            <li><strong>Thaw:</strong> move it to the fridge the night before (use within a day), or heat it from frozen in a pan with a splash of water, lid on, stirring.</li>
            <li><strong>Reheat until it bubbles all the way through.</strong> Thawed sauce is never refrozen.</li>
          </ol>
          <p className="mt-2">More detail: <Link href="/techniques/freezing" className="underline">Freezing, thawing &amp; cooling food safely</Link>.</p>
        </details>
        <SauceBatchClient sauces={sauceOptions} />
      </section>

      <h2 className="font-display text-lg font-semibold mb-2">Whole-meal prep</h2>
      <PrepClient recipes={prepRecipes.map((r) => ({ id: r.id, title: r.title, servings: r.servings }))} planId={plan?.id ?? null} />

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold mb-2">This prep session</h2>
        {session.length === 0 ? (
          <p className="text-sm text-ink-muted">No batches waiting to be cooked. Add one above, or generate a week on the plan — prep recipes become a Sunday session.</p>
        ) : (
          <>
            <ul className="grid gap-2 sm:grid-cols-2 mb-4">
              {session.map((b) => (
                <li key={b.id} className="glass-card p-3 text-sm flex flex-wrap items-center gap-2">
                  <Link href={`/recipes/${b.recipe.slug}?servings=${b.portions}`} className="font-semibold hover:underline flex-1">{b.recipe.title}</Link>
                  {b.recipe.kind === "lesson" ? (
                    <>
                      <Chip tone="sea">cook {b.portions} · eat {b.eaten} tonight · freeze {b.portions - b.eaten}</Chip>
                      <PrepAction id={b.id} action="cooked-freezer" label={`Cooked → ${b.portions - b.eaten} in the freezer`} />
                    </>
                  ) : (
                    <>
                      <Chip>{b.portions} portions</Chip>
                      <PrepAction id={b.id} action="cooked" label="Cooked → fridge" />
                      <PrepAction id={b.id} action="cooked-freezer" label="Cooked → freezer" />
                    </>
                  )}
                  <PrepAction id={b.id} action="delete" label="Remove" />
                </li>
              ))}
            </ul>
            <div className="glass-card p-4" data-testid="prep-timeline">
              <h3 className="font-semibold mb-2">Session timeline — about {timeline.total} min</h3>
              <div className="grid sm:grid-cols-2 gap-4">
                {(["alex", "sam"] as const).map((lane) => (
                  <ol key={lane} className="space-y-1.5 text-sm">
                    <li className="font-semibold">{lane === "alex" ? "Alex" : "Sam"} · done at {lane === "alex" ? timeline.alexEnd : timeline.samEnd} min</li>
                    {timeline.items.filter((i) => i.lane === lane).map((i) => (
                      <li key={i.n} className="rounded-lg bg-sand p-2"><span className="font-mono text-clay-deep">{i.start}–{i.end}′</span> {i.text}</li>
                    ))}
                  </ol>
                ))}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold mb-2">In the fridge & freezer</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {batches.filter((b) => b.cookedAt && b.eaten < b.portions).map((b) => {
            const keeps = b.location === "freezer" ? b.recipe.freezerDays ?? 90 : b.recipe.fridgeDays ?? 3;
            const left = keeps - Math.floor((today - b.cookedAt!.getTime()) / 86_400_000);
            return (
              <li key={b.id} className="glass-card p-3 text-sm">
                <div className="flex items-center gap-2">
                  <Link href={`/recipes/${b.recipe.slug}`} className="font-semibold hover:underline flex-1">{b.recipe.title}</Link>
                  <Chip tone={b.location === "freezer" ? "sea" : "olive"}>{b.location}</Chip>
                </div>
                <p><strong>{b.portions - b.eaten}</strong> of {b.portions} portions left · cooked {b.cookedAt!.toISOString().slice(0, 10)}</p>
                <p className={left <= 1 ? "text-clay-deep font-semibold" : "text-olive"}>{left < 0 ? "past its limit — throw away" : `${left} day${left === 1 ? "" : "s"} left`}</p>
                {b.recipe.reheat && <p className="text-xs text-ink-muted">Reheat: {b.recipe.reheat}</p>}
                {b.recipe.kind === "lesson" && b.recipe.goesWith && <p className="text-xs text-ink-muted">Cook fresh with it: {b.recipe.goesWith}</p>}
                {b.recipe.kind === "lesson" && b.location === "freezer" && <p className="text-xs text-ink-muted">Thaw in the fridge the night before, or heat from frozen in a pan with a splash of water.</p>}
                <div className="mt-2 flex gap-2">
                  {b.recipe.kind === "lesson" && b.portions - b.eaten >= 2 && <PrepAction id={b.id} action="eat-2" label="Used 2 (dinner for two)" />}
                  <PrepAction id={b.id} action="eat" label={b.recipe.kind === "lesson" ? "Used 1" : "Ate 1 portion"} />
                  {b.location === "fridge" && (b.recipe.freezerDays ?? 0) > 0 && <PrepAction id={b.id} action="move-freezer" label="Move to freezer" />}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold mb-2">Meal-prep recipes</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {prepRecipes.map((r) => (
            <Link key={r.id} href={`/recipes/${r.slug}`} className="glass-card overflow-hidden">
              <Pic image={r.hero} alt={r.title} className="aspect-[4/3] w-full" rounded="rounded-none" />
              <div className="p-3 text-sm">
                <p className="font-semibold">{r.title}</p>
                <p className="text-ink-muted">{r.servings} portions · fridge {r.fridgeDays ?? "?"} d · freezer {r.freezerDays ? `${Math.round(r.freezerDays / 30)} mo` : "no"}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
