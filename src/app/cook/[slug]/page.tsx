import { notFound, redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { recipeVM } from "@/lib/recipe-view";
import { CookAlong, type Drill } from "@/components/CookAlong";
import { TimerProvider } from "@/components/Timers";
import { prisma } from "@/lib/prisma";
import { localDay, weekStart } from "@/lib/utils";
import { drillServings, drillStartIndex } from "@/lib/sauce-ladder";

export const dynamic = "force-dynamic";

export default async function CookPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ view?: string; drill?: string; servings?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { slug } = await params;
  const { view, drill, servings } = await searchParams;
  const r = await recipeVM(slug, user.id);
  if (!r) notFound();
  const v = view === "mise" || view === "together" ? view : "steps";
  // ?drill=1 — practise one sauce on its own (Sauce School lessons only)
  let d: Drill | undefined;
  if (drill === "1" && r.sauceFamily) {
    const protein = new Set(r.lines.filter((l) => l.ingredient.protein).map((l) => l.id));
    const today = localDay();
    const dow = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
    const plan = await prisma.mealPlan.findUnique({ where: { weekStart: weekStart(new Date(`${today}T12:00:00Z`)) }, include: { slots: { where: { day: dow, meal: "dinner" }, include: { recipe: { select: { slug: true, title: true } } } } } });
    const dinner = plan?.slots[0]?.recipe;
    d = {
      start: drillStartIndex(r.steps.map((s) => ({ text: s.text, lineIds: s.lineIds })), protein),
      servings: drillServings(Number(servings)),
      tonight: dinner && dinner.slug !== r.slug ? { slug: dinner.slug, title: dinner.title } : null,
    };
  }
  return (
    <TimerProvider>
      <CookAlong r={r} initialView={v} drill={d} />
    </TimerProvider>
  );
}
