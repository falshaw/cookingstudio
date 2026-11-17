import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { GlucoseUpload } from "@/components/GlucoseUpload";
import { daySummary } from "@/lib/glucose";
import { isRealDay, weekStart } from "@/lib/utils";

const MEAL_TIME: Record<string, number> = { breakfast: 8, lunch: 13, snack: 16, dinner: 19.5 };

// CGM curve per day with meal markers (food log + plan). Private: only the signed-in user's own
// readings and food log — no partner view.
export default async function GlucosePage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const me = (await currentUser())!;
  const sp = await searchParams;
  const latest = await prisma.glucoseReading.findFirst({ where: { userId: me.id }, orderBy: { at: "desc" } });
  const day = sp.date && isRealDay(sp.date) ? sp.date : latest ? latest.at.toISOString().slice(0, 10) : null;
  const start = day ? new Date(`${day}T00:00:00Z`) : null;
  const end = start ? new Date(start.getTime() + 86_400_000) : null;
  const readings = start ? await prisma.glucoseReading.findMany({ where: { userId: me.id, at: { gte: start, lt: end! } }, orderBy: { at: "asc" } }) : [];
  const count = await prisma.glucoseReading.count({ where: { userId: me.id } });
  const foods = start ? await prisma.foodLog.findMany({ where: { userId: me.id, date: start } }) : [];
  const plan = start ? await prisma.mealPlan.findUnique({ where: { weekStart: weekStart(start) }, include: { slots: { include: { recipe: { select: { title: true } } } } } }) : null;
  const dow = start ? (start.getUTCDay() + 6) % 7 : -1;
  const markers = [
    ...foods.map((f) => ({ t: MEAL_TIME[f.meal] ?? 12, label: f.label, src: "log" })),
    ...(plan?.slots ?? []).filter((s) => s.day === dow && !foods.some((f) => f.meal === s.meal)).map((s) => ({ t: MEAL_TIME[s.meal] ?? 12, label: s.recipe.title, src: "plan" })),
  ];
  const sum = daySummary(readings.map((r) => ({ at: r.at, mgdl: r.mgdl })));
  const W = 720, H = 220, P = 34;
  const x = (h: number) => P + (h / 24) * (W - 2 * P);
  const vmax = Math.max(200, ...readings.map((r) => r.mgdl));
  const y = (v: number) => H - P - (v / vmax) * (H - 2 * P);
  const hours = (d: Date) => d.getUTCHours() + d.getUTCMinutes() / 60;
  const path = readings.map((r, i) => `${i ? "L" : "M"}${x(hours(r.at)).toFixed(1)},${y(r.mgdl).toFixed(1)}`).join(" ");
  const shift = (n: number) => (start ? new Date(start.getTime() + n * 86_400_000).toISOString().slice(0, 10) : "");

  return (
    <div className="max-w-4xl">
      <PageHeader eyebrow="private · stays on this PC" title="Glucose sensor">
        Import a FreeStyle Libre (LibreView) or Dexcom Clarity CSV export and see the day&apos;s curve next to your meals.
      </PageHeader>
      <GlucoseUpload count={count} />
      {!day ? (
        <p className="glass-card p-6 text-ink-muted mt-4">No readings yet — import a CSV export above.</p>
      ) : (
        <section className="glass-card p-4 mt-4" data-testid="glucose-chart">
          <div className="flex items-center gap-2 mb-2">
            <Link href={`/glucose?date=${shift(-1)}`} className="btn-secondary !px-3 !py-1">‹</Link>
            <span className="font-semibold">{day}</span>
            <Link href={`/glucose?date=${shift(1)}`} className="btn-secondary !px-3 !py-1">›</Link>
            {sum && <span className="ml-auto text-sm">avg <strong>{sum.avg}</strong> mg/dL · {sum.min}–{sum.max} · {sum.inRange}% in 70–180</span>}
          </div>
          {readings.length === 0 ? (
            <p className="text-sm text-ink-muted">No readings on this day.</p>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Glucose on ${day}: ${readings.length} readings, average ${sum?.avg} mg/dL`}>
              <rect x={P} width={W - 2 * P} y={y(180)} height={y(70) - y(180)} fill="#b6ff3d" opacity="0.1" />
              {[0, 6, 12, 18, 24].map((hh) => <text key={hh} x={x(hh)} y={H - 10} fontSize="10" textAnchor="middle" fill="#a39dbd">{String(hh).padStart(2, "0")}:00</text>)}
              {[70, 180].map((v) => <text key={v} x={4} y={y(v) + 3} fontSize="9" fill="#b6ff3d">{v}</text>)}
              {markers.map((m, i) => (
                <g key={i}>
                  <line x1={x(m.t)} x2={x(m.t)} y1={P - 10} y2={H - P} stroke={m.src === "log" ? "#ff4fd8" : "#ffb03d"} strokeDasharray="3 3" />
                  <text x={x(m.t) + 3} y={P - 12 + (i % 2) * 11} fontSize="9" fill="#f4f1ff">{m.label.slice(0, 28)}</text>
                </g>
              ))}
              <path d={path} fill="none" stroke="#3df5ff" strokeWidth="2" />
            </svg>
          )}
          <p className="text-xs text-ink-muted mt-1">Shaded band = 70–180 mg/dL (the international consensus &quot;time in range&quot;). Meal lines: red = food log, gold = meal plan (typical meal times). Times as recorded by the sensor. A pattern view, not medical advice.</p>
        </section>
      )}
    </div>
  );
}
