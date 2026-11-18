import { HOUSEHOLD_ORDER } from "@/lib/household";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { PageHeader, Stars, Chip, Empty } from "@/components/ui";
import { weekStart } from "@/lib/utils";
import { DeleteCookButton } from "@/components/DeleteCookButton";

export default async function LogPage({ searchParams }: { searchParams: Promise<{ who?: string }> }) {
  const me = (await currentUser())!;
  const { who } = await searchParams;
  const users = await prisma.user.findMany({ orderBy: HOUSEHOLD_ORDER, include: { profile: { select: { practiceGoalPerWeek: true } } } });
  const sel = users.find((u) => u.slug === who) ?? users.find((u) => u.id === me.id)!;
  const [logs, levels, lessons] = await Promise.all([
    prisma.cookLog.findMany({ where: { userId: sel.id }, orderBy: { cookedAt: "desc" }, include: { recipe: { select: { slug: true, title: true, level: true } } } }),
    prisma.level.findMany({ orderBy: { number: "asc" } }),
    prisma.recipe.findMany({ where: { kind: "lesson", status: "published" }, select: { id: true, level: true } }),
  ]);
  const ws = weekStart(new Date());
  const thisWeek = logs.filter((l) => l.cookedAt >= ws).length;
  const goal = sel.profile?.practiceGoalPerWeek ?? 3;
  const cookedIds = new Set(logs.map((l) => l.recipeId));
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="Practice" title="Cooked log" />
      <div className="flex gap-2 mb-4">
        {users.map((u) => (
          <Link key={u.id} href={`/log?who=${u.slug}`} className={`rounded-full border px-4 py-1.5 text-sm ${u.id === sel.id ? "bg-clay/10 border-clay/30 text-clay-deep font-semibold" : "border-line"}`}>{u.name}</Link>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3 mb-6">
        <div className="glass-card p-4">
          <p className="text-xs text-ink-muted">This week</p>
          <p className="text-2xl font-bold">{thisWeek} / {goal}</p>
          <div className="h-2 rounded-full bg-line mt-1 overflow-hidden"><div className="h-full bg-olive" style={{ width: `${Math.min(100, (thisWeek / goal) * 100)}%` }} /></div>
          <p className="text-xs text-ink-muted mt-1">weekly practice goal</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-ink-muted">Total cooks</p>
          <p className="text-2xl font-bold">{logs.length}</p>
          <p className="text-xs text-ink-muted">{cookedIds.size} different recipes</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-ink-muted mb-1">Level progress</p>
          <div className="flex gap-1">
            {levels.map((lv) => {
              const all = lessons.filter((r) => r.level === lv.number);
              const done = all.filter((r) => cookedIds.has(r.id)).length;
              const pct = all.length ? done / all.length : 0;
              return (
                <div key={lv.number} className="flex-1 text-center" title={`Level ${lv.number}: ${done}/${all.length}`}>
                  <div className="h-10 rounded bg-line relative overflow-hidden"><div className="absolute bottom-0 inset-x-0 bg-olive" style={{ height: `${pct * 100}%` }} /></div>
                  <span className="text-[10px] text-ink-muted">L{lv.number}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {logs.length === 0 ? (
        <Empty>No cooks logged yet. Open any recipe and tap “Mark as cooked” when you&apos;re done.</Empty>
      ) : (
        <ul className="space-y-2" data-testid="log-list">
          {logs.map((l) => (
            <li key={l.id} className="glass-card p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/recipes/${l.recipe.slug}`} className="font-semibold hover:underline flex-1">{l.recipe.title}</Link>
                <span className="text-ink-muted">{l.cookedAt.toISOString().slice(0, 10)}</span>
                <Stars n={l.rating} />
                <Chip tone={l.confidence >= 4 ? "olive" : "gold"}>confidence {l.confidence}/5</Chip>
                {sel.id === me.id && <DeleteCookButton id={l.id} label={`${l.recipe.title} (${l.cookedAt.toISOString().slice(0, 10)})`} />}
              </div>
              {l.notes && <p className="mt-1 text-ink-soft">{l.notes}</p>}
              {l.tweak && <p className="mt-1 text-[#7a5f0e]">Tweak next time: {l.tweak}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
