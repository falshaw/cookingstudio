import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader, Chip } from "@/components/ui";
import { CheckCircle2, Circle } from "lucide-react";

export default async function PathPage() {
  const [levels, recipes, users, cooks] = await Promise.all([
    prisma.level.findMany({ orderBy: { number: "asc" } }),
    prisma.recipe.findMany({ where: { kind: "lesson", status: "published" }, orderBy: { title: "asc" }, select: { id: true, slug: true, title: true, level: true } }),
    prisma.user.findMany({ orderBy: { slug: "desc" }, select: { id: true, name: true } }),
    prisma.cookLog.findMany({ select: { userId: true, recipeId: true, confidence: true } }),
  ]);
  const cooked = (uid: string, rid: string) => cooks.some((c) => c.userId === uid && c.recipeId === rid);
  return (
    <div>
      <PageHeader eyebrow="Learn by doing" title="Skill path">
        Eight levels, nothing locked. Levels 1–2 are quick refreshers — skip them if you know them. Progress is per person.
      </PageHeader>
      <ol className="space-y-5">
        {levels.map((lv) => {
          const rs = recipes.filter((r) => r.level === lv.number);
          return (
            <li key={lv.number} id={`level-${lv.number}`} className="glass-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-clay-text">Level {lv.number}{lv.refresher && " · refresher, skippable"}</p>
                  <h2 className="font-display text-xl font-bold">{lv.title}</h2>
                  <p className="text-ink-soft text-sm">{lv.subtitle}</p>
                </div>
                <div className="flex gap-3">
                  {users.map((u) => {
                    const done = rs.filter((r) => cooked(u.id, r.id)).length;
                    const pct = rs.length ? Math.round((done / rs.length) * 100) : 0;
                    return (
                      <div key={u.id} className="min-w-[7rem]">
                        <p className="text-xs text-ink-muted">{u.name} · {done}/{rs.length}</p>
                        <div className="h-2 rounded-full bg-line overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${u.name} level ${lv.number} progress`}>
                          <div className="h-full bg-olive" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="mt-2 text-sm text-ink-soft">{lv.description}</p>
              <ul className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {rs.map((r) => (
                  <li key={r.id}>
                    <Link href={`/recipes/${r.slug}`} className="flex items-center gap-2 rounded-xl border border-line px-3 py-2 hover:border-clay">
                      <span className="flex gap-0.5">
                        {users.map((u) => (cooked(u.id, r.id) ? <CheckCircle2 key={u.id} size={16} className="text-olive" aria-label={`${u.name} cooked it`} /> : <Circle key={u.id} size={16} className="text-line" aria-label={`${u.name} not yet`} />))}
                      </span>
                      <span className="text-sm">{r.title}</span>
                    </Link>
                  </li>
                ))}
                {rs.length === 0 && <li><Chip>no recipes yet</Chip></li>}
              </ul>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
