// Weekly report: every number is computed in code; the local Ollama model only writes a short
// plain summary of those numbers when Ollama is already running. Lab values are NOT included.
import { prisma } from "./prisma";
import { REFERENCE, referenceGroup, smoothWeights, sourceLabel, weekStats } from "./health-stats";
import { generateValidated } from "./ollama";
import { z } from "zod";

export async function reportNumbers(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: true } });
  const stats = await weekStats(user);
  const w = smoothWeights((await prisma.weightEntry.findMany({ where: { userId }, orderBy: { date: "asc" } })).map((x) => ({ date: x.date.toISOString().slice(0, 10), kg: x.kg })));
  const who = referenceGroup(user.profile?.referenceGroup);
  const gaps = (user.profile?.trackedNutrients ?? []).filter((k) => REFERENCE[k]).map((k) => ({ label: REFERENCE[k].label, pct: Math.round(((stats.dailyAvg[k] ?? 0) / REFERENCE[k].values[who]) * 100) }));
  const last = w[w.length - 1];
  const weekAgo = w.filter((x) => new Date(x.date).getTime() <= Date.now() - 7 * 86_400_000).pop();
  return {
    user,
    stats,
    weight: last ? { latest: last.kg, trend: last.trend, change7: weekAgo ? Math.round((last.trend - weekAgo.trend) * 10) / 10 : null } : null,
    gaps,
    nextLab: user.profile?.nextLabDate?.toISOString().slice(0, 10) ?? null,
  };
}

export async function reportSummary(userId: string, log: (m: string) => Promise<void>) {
  const n = await reportNumbers(userId);
  const a = n.stats.avgPerMeal;
  const facts = [
    a ? `days counted: ${sourceLabel(n.stats)}; average per meal: ${a.netCarbs} g net carbs, ${a.protein} g protein${a.fibre != null ? `, ${a.fibre} g fibre, ${a.satFat} g saturated fat, glycemic load ${a.gl}` : ""}` : "no meal plan and no food log this week",
    `oily-fish meals this week: ${n.stats.fish}`,
    n.weight ? `weight 7-day average ${n.weight.trend} kg${n.weight.change7 != null ? `, ${n.weight.change7 >= 0 ? "+" : ""}${n.weight.change7} kg vs a week ago` : ""}` : "no weight entries",
    n.gaps.length ? `nutrients vs reference intake: ${n.gaps.map((g) => `${g.label} ${g.pct}%`).join(", ")}` : "",
  ].filter(Boolean).join("; ");
  const out = await generateValidated({
    prompt: `Write a 3-4 sentence weekly summary for ${n.user.name} of these numbers about their meals (logged days use what they ate, the other days the meal plan) and weight. Use only these numbers, add no medical advice, no diagnosis, no dosing. Plain, friendly, practical (one cooking idea for the weakest number). Numbers: ${facts}`,
    system: "You summarise food-planning numbers. Never give medical advice. Answer only with JSON.",
    schema: z.object({ summary: z.string().min(20).max(900) }),
    attempts: 2,
    onLog: log,
  });
  return { summary: out.summary, facts, userId };
}
