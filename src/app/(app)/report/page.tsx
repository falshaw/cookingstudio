import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { WeekHealth } from "@/components/WeekHealth";
import { WeightChart } from "@/components/WeightClient";
import { ReportSummaryButton } from "@/components/ReportSummaryButton";
import { reportNumbers } from "@/lib/report";
import { smoothWeights, sourceLabel } from "@/lib/health-stats";
import { weekStart } from "@/lib/utils";
import { ollamaUp } from "@/lib/ollama";

// Private: always the signed-in user's own report — no view of anyone else.
export default async function ReportPage() {
  const me = (await currentUser())!;
  const n = await reportNumbers(me.id);
  const weights = await prisma.weightEntry.findMany({ where: { userId: me.id }, orderBy: { date: "asc" } });
  const wrows = smoothWeights(weights.map((w) => ({ date: w.date.toISOString().slice(0, 10), kg: w.kg }))).map((w, i) => ({ ...w, id: weights[i].id }));
  const ws = weekStart(new Date());
  const lastSummary = await prisma.job.findFirst({ where: { type: "report", status: "done", userId: me.id, createdAt: { gte: ws }, input: { path: ["userId"], equals: me.id } }, orderBy: { createdAt: "desc" } });
  const summary = (lastSummary?.result as { summary?: string } | null)?.summary;
  const up = await ollamaUp();
  const a = n.stats.avgPerMeal;
  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow={`week of ${ws.toISOString().slice(0, 10)} · private`} title={`Weekly report — ${me.name}`} />
      <section className="glass-card p-4 mb-4" data-testid="report-summary">
        <h2 className="font-display text-lg font-semibold mb-1">Summary</h2>
        {summary ? <p className="text-ink-soft">{summary}</p> : <p className="text-sm text-ink-muted">Numbers only{up ? " — the local AI can write a short summary of them." : " — the local AI (Ollama) is not running, so there is no written summary."}</p>}
        {up && <ReportSummaryButton />}
      </section>
      <div className="grid gap-3 sm:grid-cols-4 mb-4 text-sm">
        <div className="glass-card p-3"><p className="text-xs text-ink-muted">Weight (7-day avg)</p><p className="text-xl font-bold">{n.weight ? `${n.weight.trend} kg` : "—"}</p>{n.weight?.change7 != null && <p className="text-xs">{n.weight.change7 >= 0 ? "+" : ""}{n.weight.change7} kg vs last week</p>}</div>
        <div className="glass-card p-3" data-testid="report-per-meal"><p className="text-xs text-ink-muted">Per meal · {sourceLabel(n.stats)}</p><p className="font-semibold">{a ? `${a.netCarbs} g net carbs${a.gl != null ? ` · GL ${a.gl}` : ""}` : "no plan or log"}</p>{a && <p className="text-xs">{a.protein} g protein{a.fibre != null ? ` · ${a.fibre} g fibre · ${a.satFat} g sat fat` : ""}{a.nDetailed < a.n ? ` (fibre/fat over ${a.nDetailed} of ${a.n} meals with a recipe)` : ""}</p>}</div>
        <div className="glass-card p-3"><p className="text-xs text-ink-muted">Oily-fish meals</p><p className="text-xl font-bold">{n.stats.fish}</p></div>
        <div className="glass-card p-3"><p className="text-xs text-ink-muted">Next blood test</p><p className="text-xl font-bold">{n.nextLab ?? "—"}</p></div>
      </div>
      <section className="glass-card p-4 mb-4"><h2 className="font-display text-lg font-semibold mb-2">Weight</h2><WeightChart rows={wrows} /></section>
      <section className="glass-card p-4"><WeekHealth stats={n.stats} group={n.user.profile?.referenceGroup} tracked={n.user.profile?.trackedNutrients ?? []} /></section>
      <p className="mt-3 text-xs text-ink-muted">All numbers are computed by the app from USDA data — your food log on days you logged, your plan on the others; lab values are never sent to the AI.</p>
    </div>
  );
}
