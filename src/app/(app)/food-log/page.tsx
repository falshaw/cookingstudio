import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { FoodLogClient } from "@/components/FoodLogClient";
import { addDays, isRealDay, localDay } from "@/lib/utils";
import { recentFoods } from "@/lib/food-log";
import { ollamaUp } from "@/lib/ollama";
import { PhotoLog } from "@/components/PhotoLog";
import { planDayStatus } from "@/lib/plan-log";
import { isLongView, parseView } from "@/lib/food-log-range";
import { LongRangeView, MonthView, ViewSwitch, WeekView } from "@/components/FoodLogRange";

export default async function FoodLogPage({ searchParams }: { searchParams: Promise<{ date?: string; view?: string }> }) {
  const me = (await currentUser())!;
  const { date, view: rawView } = await searchParams;
  const today = localDay();
  const day = date && isRealDay(date) ? date : today;
  const view = parseView(rawView);
  const header = (
    <PageHeader eyebrow={`${me.name} · optional · private`} title="Food log">
      Log what you ate; totals come from the USDA table and are compared with your daily targets (set them on Profiles).
    </PageHeader>
  );
  if (view !== "day") {
    // Week / month / 3 mo / 6 mo / year: the client reads MY totals from /api/food-log(/summary) (owner-scoped there).
    const profile = await prisma.userProfile.findUnique({ where: { userId: me.id }, select: { dailyKcal: true, dailyProtein: true, dailyNetCarbs: true } });
    const targets = { kcal: profile?.dailyKcal ?? null, protein: profile?.dailyProtein ?? null, netCarbs: profile?.dailyNetCarbs ?? null };
    return (
      <div className="max-w-3xl space-y-4">
        {header}
        <ViewSwitch view={view} day={day} />
        {view === "week" && <WeekView key={day} day={day} today={today} targets={targets} />}
        {view === "month" && <MonthView key={day} day={day} today={today} targets={targets} />}
        {isLongView(view) && <LongRangeView key={`${view}-${day}`} view={view} day={day} today={today} targets={targets} />}
      </div>
    );
  }
  const [entries, profile, recipes, ingredients, last14] = await Promise.all([
    prisma.foodLog.findMany({ where: { userId: me.id, date: new Date(`${day}T00:00:00Z`) }, orderBy: { createdAt: "asc" } }),
    prisma.userProfile.findUnique({ where: { userId: me.id } }),
    prisma.recipe.findMany({ where: { status: "published" }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    prisma.ingredient.findMany({ where: { fdcId: { not: null } }, orderBy: { nameEn: "asc" }, select: { id: true, nameEn: true } }),
    // "Recent": my own distinct foods of the last 14 days
    prisma.foodLog.findMany({ where: { userId: me.id, date: { gte: new Date(`${addDays(today, -14)}T00:00:00Z`) } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 400 }),
  ]);
  const photoEnabled = await ollamaUp();
  // "Ate today's plan": only today or a past day of a plan week, my own slots' status
  const planDay = day <= today ? await planDayStatus(me.id, day) : null;
  return (
    <div className="max-w-3xl">
      {header}
      <div className="mb-4"><PhotoLog enabled={photoEnabled} day={day} meal="dinner" ingredients={ingredients} /></div>
      <FoodLogClient
        key={day}
        switcher={<ViewSwitch view="day" day={day} />}
        day={day}
        today={today}
        recent={recentFoods(last14)}
        planDay={planDay}
        entries={entries.map((e) => ({ id: e.id, meal: e.meal, label: e.label, portions: e.portions, kcal: e.kcal, protein: e.protein, netCarbs: e.netCarbs, fat: e.fat }))}
        targets={{ kcal: profile?.dailyKcal ?? null, protein: profile?.dailyProtein ?? null, netCarbs: profile?.dailyNetCarbs ?? null }}
        recipes={recipes}
        ingredients={ingredients}
      />
    </div>
  );
}
