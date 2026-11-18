import { HOUSEHOLD_ORDER } from "@/lib/household";
import Link from "next/link";
import {
  Search, ChefHat, AlertTriangle, Repeat, Carrot, Egg, Fish, Cherry, Croissant, Pizza, Salad, Soup, Beef, Citrus, Wheat, Flame, UtensilsCrossed,
} from "lucide-react";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { practiceMap, makeAgain } from "@/lib/practice";
import { Pic, Chip, Stars } from "@/components/ui";
import { FeedInbox } from "@/components/FeedInbox";
import { weekStart, serverNow, localDay, isoDate, fmtMinutes, appTimeZone } from "@/lib/utils";
import { PLAN_MEALS, dayIndex, planKey, recipeEntryMacros } from "@/lib/plan-log";
import { cookStreak, heroLabel, pickHeroMeal, ringOffset } from "@/lib/dashboard";
import "./neon-dash.css";

// Neon night market dashboard: a film frame with the next meal, neon gauges for what was eaten today,
// the shopping light box, the week's dinners as hanging signs, glowing food icons flying across the page.
// The working sections (continue cooking, level progress, recent cooks, feed inbox) follow below the "street".

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HERO_SELECT = { select: { id: true, status: true, video: true } } as const;

export default async function Dashboard() {
  const me = (await currentUser())!;
  const day = localDay();
  const ws = weekStart(new Date(`${day}T00:00:00Z`));
  const wsIso = isoDate(ws);
  const today = dayIndex(wsIso, day) ?? 0;
  const [users, recipes, lessons, cooks, recent, drafts, expiring, plan, sauces, profile, foodToday, shop] = await Promise.all([
    prisma.user.findMany({ orderBy: HOUSEHOLD_ORDER, include: { profile: { select: { practiceGoalPerWeek: true } } } }),
    prisma.recipe.findMany({ where: { status: "published" }, include: { hero: HERO_SELECT } }),
    prisma.recipe.findMany({ where: { kind: "lesson", status: "published" }, select: { id: true, level: true } }),
    prisma.cookLog.findMany({ select: { userId: true, recipeId: true, cookedAt: true } }),
    prisma.cookLog.findMany({ orderBy: { cookedAt: "desc" }, take: 6, include: { recipe: { select: { slug: true, title: true } }, user: { select: { name: true } } } }),
    prisma.recipe.findMany({ where: { status: "draft" }, orderBy: { createdAt: "desc" }, include: { hero: HERO_SELECT } }),
    prisma.stockItem.findMany({ where: { status: { not: "out" }, bestBefore: { lte: new Date(serverNow() + 2 * 86_400_000) } }, include: { ingredient: { select: { nameEn: true, id: true } } }, orderBy: { bestBefore: "asc" } }),
    prisma.mealPlan.findUnique({ where: { weekStart: ws }, include: { slots: { include: { recipe: { select: { id: true, slug: true, title: true, prepMinutes: true, cookMinutes: true, hero: HERO_SELECT } } } } } }),
    prisma.recipe.findMany({ where: { sauceFamily: { not: null }, status: "published" }, orderBy: { level: "asc" }, select: { id: true, slug: true, title: true } }),
    prisma.userProfile.findUnique({ where: { userId: me.id } }),
    prisma.foodLog.findMany({ where: { userId: me.id, date: new Date(`${day}T00:00:00Z`) }, select: { kcal: true, protein: true, netCarbs: true, planKey: true } }),
    prisma.shoppingList.findFirst({ orderBy: { createdAt: "desc" }, include: { items: { where: { checked: false, inPantry: false }, orderBy: { sort: "asc" }, select: { id: true, name: true } } } }),
  ]);
  const pm = await practiceMap(me.id);
  const disliked = new Set((await prisma.dislike.findMany({ where: { userId: me.id, recipeId: { not: null } }, select: { recipeId: true } })).map((d) => d.recipeId!));
  const again = makeAgain(recipes.filter((r) => !disliked.has(r.id)), pm).slice(0, 4);
  // same as /sauces: a sauce the viewer disliked is not part of "X of Y"
  const mySauces = sauces.filter((s) => !disliked.has(s.id));
  const nextSauce = mySauces.find((s) => !pm.has(s.id));
  const lastCooked = recent.find((r) => r.userId === me.id);
  const days = profile?.nextLabDate ? Math.ceil((profile.nextLabDate.getTime() - serverNow()) / 86_400_000) : null;
  const starter = recipes.filter((r) => r.level <= 3 && !pm.has(r.id) && !disliked.has(r.id)).slice(0, 4);

  // today's plan: which meal is the film, which are the small tiles
  const loggedKeys = new Set(foodToday.map((f) => f.planKey).filter(Boolean));
  const todaySlots = (plan?.slots ?? [])
    .filter((s) => s.day === today)
    .map((s) => ({ ...s, logged: loggedKeys.has(planKey(wsIso, today, s.meal)) }))
    .sort((a, b) => PLAN_MEALS.indexOf(a.meal as (typeof PLAN_MEALS)[number]) - PLAN_MEALS.indexOf(b.meal as (typeof PLAN_MEALS)[number]));
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "2-digit", hourCycle: "h23", timeZone: appTimeZone() }).format(new Date(serverNow())));
  const heroSlot = pickHeroMeal(todaySlots, hour);
  const others = todaySlots.filter((s) => s !== heroSlot);
  const macroBySlot = new Map(await Promise.all(todaySlots.map(async (s) => [s.id, await recipeEntryMacros(s.recipeId, 1, me.id)] as const)));
  const heroMacros = heroSlot ? macroBySlot.get(heroSlot.id) : null;
  const suggestion = !heroSlot ? (again[0] ?? starter[0] ?? null) : null;

  // eaten today vs my targets
  const eaten = foodToday.reduce((a, f) => ({ kcal: a.kcal + f.kcal, protein: a.protein + f.protein, netCarbs: a.netCarbs + f.netCarbs }), { kcal: 0, protein: 0, netCarbs: 0 });
  const gauges = [
    { label: "kcal", value: Math.round(eaten.kcal), text: String(Math.round(eaten.kcal)), target: profile?.dailyKcal, unit: "", c: "#b6ff3d" },
    { label: "protein", value: eaten.protein, text: `${Math.round(eaten.protein)} g`, target: profile?.dailyProtein, unit: " g", c: "#ff4fd8" },
    { label: "net carbs", value: eaten.netCarbs, text: `${Math.round(eaten.netCarbs)} g`, target: profile?.dailyNetCarbs, unit: " g", c: "#3df5ff" },
  ];

  const streak = cookStreak(cooks.filter((c) => c.userId === me.id).map((c) => localDay(c.cookedAt)), day);
  const toBuy = shop?.items ?? [];
  const weekSigns = DAY_NAMES.map((name, d) => {
    const slots = (plan?.slots ?? []).filter((s) => s.day === d);
    return { name, d, slot: slots.find((s) => s.meal === "dinner") ?? slots.find((s) => s.meal === "lunch") ?? slots[0] ?? null };
  });
  const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", day: "numeric", month: "long", timeZone: appTimeZone() }).format(new Date(serverNow()));

  return (
    <div className="nm">
      <div className="nm-fly" aria-hidden>
        <Carrot /><Egg /><Fish /><Cherry /><Croissant /><Pizza /><Salad /><Soup /><Beef /><Citrus /><Wheat /><Flame />
      </div>
      <i className="nm-comet" aria-hidden /><i className="nm-comet b" aria-hidden />
      {/* foreground: a few big, out-of-focus icons passing in front of everything, like objects close to the lens */}
      <div className="nm-fly nm-fly-front" aria-hidden><Cherry /><Citrus /><Carrot /><Flame /></div>

      <div className="nm-top">
        <h1 className="neon-sign nm-title">NIGHT MARKET</h1>
        <form action="/recipes" className="nm-search">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted" size={18} />
          <input name="q" placeholder="Search recipes" className="input-field pl-10" aria-label="Quick search" />
        </form>
        <div className="nm-open">
          Kitchen open
          <small>{dateLabel} · {me.name}{streak > 0 ? ` · ${streak} day${streak === 1 ? "" : "s"} cooked at home` : ""}</small>
        </div>
      </div>

      {expiring.length > 0 && (
        <div className="mb-4 rounded-xl border border-clay/40 bg-clay/10 p-3 text-sm flex flex-wrap items-center gap-2" data-testid="expiry-alert">
          <AlertTriangle size={16} className="text-clay-deep" />
          <strong>Use soon:</strong>
          {expiring.map((e) => <span key={e.ingredientId}>{e.ingredient.nameEn} ({e.bestBefore!.toISOString().slice(5, 10)})</span>)}
          <Link href={`/use-it-up?${expiring.map((e) => `use=${e.ingredientId}`).join("&")}`} className="underline text-clay-deep ml-auto">find recipes</Link>
        </div>
      )}

      <div className="nm-lay">
        <section className="nm-film" data-testid="tonight">
          <div className="nm-bar t" aria-hidden /><div className="nm-bar b" aria-hidden />
          {heroSlot ? (
            <>
              <div className="nm-reel"><Pic image={heroSlot.recipe.hero} alt={heroSlot.recipe.title} rounded="rounded-none" /></div>
              <div className="nm-slate">
                <span className="live">{heroSlot.logged ? "Eaten" : "Now showing"}</span>
                {heroSlot.source !== "fresh" && <span>{heroSlot.source === "leftover" ? "Leftovers" : heroSlot.source === "freezer" ? "From the freezer" : "Meal prep"}</span>}
              </div>
              <div className="nm-credits">
                <div>
                  <p className="nm-when">{heroLabel(heroSlot.meal)}</p>
                  <h2 className="nm-dish">{heroSlot.recipe.title.replace(/\s*\(.*?\)/g, "")}</h2>
                  <p className="nm-meta">
                    {fmtMinutes(heroSlot.recipe.prepMinutes + heroSlot.recipe.cookMinutes)}
                    {heroMacros && <> · <b>{Math.round(heroMacros.kcal)}</b> kcal · <b>{Math.round(heroMacros.protein)} g</b> protein · <b>{Math.round(heroMacros.netCarbs)} g</b> net carbs</>}
                  </p>
                </div>
                <div className="nm-act">
                  <Link href={`/cook/${heroSlot.recipe.slug}`} className="nm-cook">Cook it</Link>
                  <Link href={`/cook/${heroSlot.recipe.slug}?view=mise`} className="nm-mise">Get everything out first</Link>
                </div>
              </div>
            </>
          ) : suggestion ? (
            <>
              <div className="nm-reel"><Pic image={suggestion.hero} alt={suggestion.title} rounded="rounded-none" /></div>
              <div className="nm-slate"><span>Nothing planned today</span></div>
              <div className="nm-credits">
                <div>
                  <p className="nm-when">How about</p>
                  <h2 className="nm-dish">{suggestion.title.replace(/\s*\(.*?\)/g, "")}</h2>
                  <p className="nm-meta">{fmtMinutes(suggestion.prepMinutes + suggestion.cookMinutes)} · <Link href="/plan" className="underline">or plan the week</Link></p>
                </div>
                <div className="nm-act"><Link href={`/recipes/${suggestion.slug}`} className="nm-cook">Open it</Link></div>
              </div>
            </>
          ) : (
            <div className="nm-empty">
              <h2 className="nm-dish">Nothing on tonight</h2>
              <p className="nm-meta"><Link href="/plan" className="underline">Plan the week</Link> or <Link href="/recipes" className="underline">pick a recipe</Link>.</p>
            </div>
          )}
        </section>

        <div className="nm-side">
          <div className="nm-panel nm-gauges" data-testid="eaten-today">
            {gauges.map((g) => (
              <div key={g.label} className="nm-ga" style={{ ["--c" as string]: g.c }}>
                <svg viewBox="0 0 120 120" role="img" aria-label={`${g.text} ${g.label} eaten today${g.target ? ` of ${g.target}` : ""}`}>
                  <circle className="bg" cx="60" cy="60" r="52" />
                  <circle className="fg" cx="60" cy="60" r="52" strokeDashoffset={g.target ? ringOffset(g.value, g.target) : 327} />
                  <text x="60" y="69">{g.text}</text>
                </svg>
                {g.target ? <>of <b>{g.target}{g.unit}</b> {g.label}</> : g.label}
              </div>
            ))}
            <Link href="/food-log" className="nm-galink">{foodToday.length ? "Eaten today, open the food log" : "Nothing logged today yet, open the food log"}</Link>
          </div>

          {others.map((s) => {
            const m = macroBySlot.get(s.id);
            return (
              <Link key={s.id} href={`/recipes/${s.recipe.slug}`} className={`nm-mini${s.logged ? " done" : ""}`}>
                <div className="nm-reel"><Pic image={s.recipe.hero} alt="" rounded="rounded-none" /></div>
                <div className="tx">
                  <small className="capitalize">{s.meal}{s.logged ? ", eaten" : s.source === "leftover" ? ", leftovers" : ""}</small>
                  <b>{s.recipe.title.replace(/\s*\(.*?\)/g, "")}</b>
                  {m ? `${Math.round(m.kcal)} kcal · ` : ""}{fmtMinutes(s.recipe.prepMinutes + s.recipe.cookMinutes)}
                </div>
              </Link>
            );
          })}

          <div className="nm-board" data-testid="to-buy">
            <h3>Still to buy <span>{toBuy.length}</span></h3>
            {toBuy.length ? (
              <>
                {toBuy.slice(0, 8).map((i) => <span key={i.id}>{i.name}</span>)}
                {toBuy.length > 8 && <span>+ {toBuy.length - 8} more</span>}
              </>
            ) : (
              <p>{shop ? "Everything on the last list is bought." : "No shopping list yet."}</p>
            )}
            <Link href="/shopping">Open the shopping list</Link>
          </div>
        </div>
      </div>

      <div className="nm-week" data-testid="week-signs">
        {weekSigns.map(({ name, d, slot }) =>
          slot ? (
            <Link key={d} href={`/recipes/${slot.recipe.slug}`} className={`nm-sign${d === today ? " now" : ""}`}>
              <div className="nm-reel"><Pic image={slot.recipe.hero} alt="" rounded="rounded-none" /></div>
              <span className="tx"><b>{d === today ? "Today" : name}</b>{slot.recipe.title.replace(/\s*\(.*?\)/g, "")}</span>
            </Link>
          ) : (
            <Link key={d} href="/plan" className={`nm-sign none${d === today ? " now" : ""}`}>
              <div className="nm-reel"><UtensilsCrossed size={30} /></div>
              <span className="tx"><b>{d === today ? "Today" : name}</b>Nothing planned</span>
            </Link>
          ),
        )}
      </div>

      <div className="nm-facts">
        <Link href={nextSauce ? `/recipes/${nextSauce.slug}` : "/sauces"} style={{ ["--c" as string]: "#ffb03d" }}>
          <b>{mySauces.filter((s) => pm.has(s.id)).length}/{mySauces.length}</b>sauces practised{nextSauce ? `, next is ${nextSauce.title}` : ""}
        </Link>
        {drafts.length > 0 && <span className="f" style={{ ["--c" as string]: "#3df5ff" }}><b>{drafts.length}</b>new recipe{drafts.length === 1 ? "" : "s"} waiting below</span>}
        {days != null && <span className="f" style={{ ["--c" as string]: "#b6ff3d" }}><b>{days > 0 ? days : days === 0 ? "Today" : -days}</b>{days > 0 ? `day${days === 1 ? "" : "s"} to the blood test` : days === 0 ? "is the blood test" : `day${days === -1 ? "" : "s"} since the blood test`}</span>}
        <Link href="/recipes" style={{ ["--c" as string]: "#ff4fd8" }}><b>{recipes.length}</b>recipes in the library</Link>
      </div>

      <div className="nm-street" aria-hidden />

      <div className="space-y-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <section className="glass-card p-4 lg:col-span-2">
            <h2 className="font-display text-lg mb-3 flex items-center gap-2"><ChefHat size={18} /> Continue cooking</h2>
            {again.length > 0 ? (
              <>
                <p className="text-sm text-ink-muted mb-2">Cooked but not confident yet. Make it again until it&apos;s a 4/5:</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {again.map((r) => (
                    <Link key={r.id} href={`/recipes/${r.slug}`} className="flex gap-3 items-center rounded-xl border border-line p-2 hover:border-sea">
                      <Pic image={r.hero} alt={r.title} className="h-16 w-20 shrink-0" rounded="rounded-lg" />
                      <span className="text-sm"><span className="font-semibold block">{r.title}</span>cooked {pm.get(r.id)!.count}× · confidence {pm.get(r.id)!.confidence}/5</span>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-muted mb-2">{lastCooked ? `Last time: ${lastCooked.recipe.title}. ` : ""}Good first cooks:</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {starter.map((r) => (
                    <Link key={r.id} href={`/recipes/${r.slug}`} className="flex gap-3 items-center rounded-xl border border-line p-2 hover:border-sea">
                      <Pic image={r.hero} alt={r.title} className="h-16 w-20 shrink-0" rounded="rounded-lg" />
                      <span className="text-sm"><span className="font-semibold block">{r.title}</span>Level {r.level}</span>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </section>

          <section className="glass-card p-4" data-testid="level-progress">
            <h2 className="font-display text-lg mb-2">Level progress</h2>
            {users.map((u) => {
              const done = new Set(cooks.filter((c) => c.userId === u.id).map((c) => c.recipeId));
              const week = cooks.filter((c) => c.userId === u.id && c.cookedAt >= ws).length;
              return (
                <div key={u.id} className="mb-3">
                  <p className="text-sm font-semibold">{u.name} <span className="font-normal text-ink-muted">· this week {week}/{u.profile?.practiceGoalPerWeek ?? 3}</span></p>
                  <div className="flex gap-1 mt-1">
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((lv) => {
                      const all = lessons.filter((r) => r.level === lv);
                      const n = all.filter((r) => done.has(r.id)).length;
                      return <div key={lv} title={`L${lv} ${n}/${all.length}`} className="flex-1 h-3 rounded bg-line overflow-hidden"><div className="h-full bg-olive" style={{ width: `${all.length ? (n / all.length) * 100 : 0}%` }} /></div>;
                    })}
                  </div>
                </div>
              );
            })}
            <Link href="/path" className="text-sm underline text-sea-deep">Skill path</Link>
          </section>
        </div>

        <section className="glass-card p-4">
          <h2 className="font-display text-lg mb-2 flex items-center gap-2"><Repeat size={18} /> Recent cooks</h2>
          {recent.length ? (
            <ul className="text-sm grid gap-x-8 gap-y-1.5 sm:grid-cols-2">
              {recent.map((c) => (
                <li key={c.id}><Link href={`/recipes/${c.recipe.slug}`} className="hover:underline">{c.recipe.title}</Link> <span className="text-ink-muted">· {c.user.name}</span> <Stars n={c.rating} /></li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted">Nothing logged yet.</p>
          )}
        </section>

        <FeedInbox drafts={drafts.map((d) => ({ id: d.id, slug: d.slug, title: d.title, kind: d.kind, hero: d.hero }))} />
        <p className="text-xs text-ink-muted"><Chip>{recipes.length} recipes</Chip> in the library · everything open, nothing locked.</p>
      </div>
    </div>
  );
}
