import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { PageHeader, Chip } from "@/components/ui";
import { ProfileForm } from "@/components/ProfileForm";
import { getSetting } from "@/lib/feed";

export default async function ProfilesPage() {
  const me = (await currentUser())!;
  const users = await prisma.user.findMany({ orderBy: { slug: "desc" }, include: { profile: true } });
  const mine = users.find((u) => u.id === me.id)!;
  const other = users.find((u) => u.id !== me.id);
  const perWeek = await getSetting<number>("feed.perWeek", 3);
  const p = mine.profile;
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Rules the planner enforces" title="Profiles">
        Your food rules, likes and targets. The meal planner, teach-me and the new-recipes feed check every recipe against these in code. You can edit only your own profile.
      </PageHeader>
      <ProfileForm
        name={mine.name}
        feedPerWeek={perWeek}
        initial={{
          vegetarian: p?.vegetarian ?? false,
          vegBreakfastAllowed: p?.vegBreakfastAllowed ?? [],
          avoidFoods: p?.avoidFoods ?? [],
          likedFoods: p?.likedFoods ?? [],
          healthTargets: p?.healthTargets ?? "",
          goals: p?.goals ?? "",
          maxCookMinutes: p?.maxCookMinutes ?? null,
          maxLunchMinutes: p?.maxLunchMinutes ?? null,
          maxNetCarbsPerMeal: p?.maxNetCarbsPerMeal ?? null,
          minProteinPerMeal: p?.minProteinPerMeal ?? null,
          noAddedSugar: p?.noAddedSugar ?? false,
          noRefinedStarch: p?.noRefinedStarch ?? false,
          noAlcohol: p?.noAlcohol ?? false,
          omega3MinPerWeek: p?.omega3MinPerWeek ?? null,
          omega3MaxPerWeek: p?.omega3MaxPerWeek ?? null,
          redMeatMaxPerWeek: p?.redMeatMaxPerWeek ?? null,
          dailyKcal: p?.dailyKcal ?? null,
          dailyProtein: p?.dailyProtein ?? null,
          dailyNetCarbs: p?.dailyNetCarbs ?? null,
          portionFactor: p?.portionFactor ?? 1,
          practiceGoalPerWeek: p?.practiceGoalPerWeek ?? 3,
          referenceGroup: p?.referenceGroup ?? "general",
          weightLostKg: p?.weightLostKg ?? null,
          nextLabDate: p?.nextLabDate ? p.nextLabDate.toISOString().slice(0, 10) : null,
          tasteOverrides: (p?.tasteOverrides as { likes: string[]; dislikes: string[] } | null) ?? { likes: [], dislikes: [] },
        }}
      />
      {other && (
        <section className="glass-card p-4 mt-6">
          <h2 className="font-display text-lg font-semibold mb-2">{other.name}&apos;s food rules (read-only)</h2>
          <div className="flex flex-wrap gap-1.5 text-sm">
            {other.profile?.vegetarian && <Chip tone="olive">vegetarian{other.profile.vegBreakfastAllowed.length ? ` (except ${other.profile.vegBreakfastAllowed.join(", ")} at breakfast)` : ""}</Chip>}
            {other.profile?.avoidFoods.map((f) => <Chip key={f} tone="red">no {f}</Chip>)}
            {other.profile?.likedFoods.map((f) => <Chip key={f} tone="sea">likes {f}</Chip>)}
            {other.profile?.noAlcohol && <Chip>no alcohol</Chip>}
            {other.profile?.noAddedSugar && <Chip>no added sugar</Chip>}
            {other.profile?.maxNetCarbsPerMeal != null && <Chip>≤{other.profile.maxNetCarbsPerMeal} g net carbs / meal</Chip>}
            {!other.profile?.vegetarian && !other.profile?.avoidFoods.length && !other.profile?.likedFoods.length && <span className="text-ink-muted">Nothing filled in yet.</span>}
          </div>
        </section>
      )}
    </div>
  );
}
