// Week + month views of the food log. Pure and client-safe — unit-tested in tests/food-log-range.test.ts.
// Days are YYYY-MM-DD strings (calendar days in APP_TIMEZONE, as stored); all arithmetic is on UTC midnight.
import type { DayTotal } from "./food-log";
import { addDays } from "./utils";

export const VIEWS = ["day", "week", "month", "3m", "6m", "1y"] as const;
export type View = (typeof VIEWS)[number];
export const parseView = (v: string | undefined | null): View => (VIEWS as readonly string[]).includes(v ?? "") ? (v as View) : "day";

const dow = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Mon = 0 … Sun = 6

/** Mon–Sun of the week that contains `day`. */
export function weekDays(day: string): string[] {
  const mon = addDays(day, -dow(day));
  return Array.from({ length: 7 }, (_, i) => addDays(mon, i));
}

/** Every day of the calendar month that contains `day`. */
export function monthDays(day: string): string[] {
  const first = `${day.slice(0, 7)}-01`;
  const out: string[] = [];
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) out.push(d);
  return out;
}

/** First day of the month `n` months away from the month of `day`. */
export function shiftMonth(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

/** Calendar grid Mon-first: rows of 7, `null` = a cell outside the month. */
export function monthGrid(day: string): (string | null)[][] {
  const days = monthDays(day);
  const cells: (string | null)[] = [...Array<null>(dow(days[0])).fill(null), ...days];
  while (cells.length % 7) cells.push(null);
  const rows: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

/** One total per requested day, in that order; a day with no entries gets zeros and `entries: 0`. */
export function fillDays(days: string[], totals: DayTotal[]): DayTotal[] {
  const by = new Map(totals.map((t) => [t.date, t]));
  return days.map((d) => by.get(d) ?? { date: d, kcal: 0, protein: 0, netCarbs: 0, fat: 0, entries: 0 });
}

export interface Macros { kcal: number; protein: number; netCarbs: number; fat: number }
export interface RangeSummary { total: Macros & { entries: number }; avg: Macros | null; logged: number; of: number }

/** Range total, and the daily average over LOGGED days only (a day with ≥ 1 entry); `avg` is null when none is. */
export function summarise(days: DayTotal[]): RangeSummary {
  const total = { kcal: 0, protein: 0, netCarbs: 0, fat: 0, entries: 0 };
  let logged = 0;
  for (const d of days) {
    total.kcal += d.kcal;
    total.protein += d.protein;
    total.netCarbs += d.netCarbs;
    total.fat += d.fat;
    total.entries += d.entries;
    if (d.entries > 0) logged++;
  }
  const avg = logged ? { kcal: total.kcal / logged, protein: total.protein / logged, netCarbs: total.netCarbs / logged, fat: total.fat / logged } : null;
  return { total, avg, logged, of: days.length };
}

export type Status = "under" | "on" | "over";
/** Within ±10 % of the target counts as on target. */
export const TOLERANCE = 0.1;

/** under / on / over vs a daily target; null without a target. */
export function targetStatus(value: number, target: number | null | undefined, tol = TOLERANCE): Status | null {
  if (!target || target <= 0) return null;
  if (value < target * (1 - tol)) return "under";
  if (value > target * (1 + tol)) return "over";
  return "on";
}

export type Nutrient = "kcal" | "protein" | "netCarbs";
export type Tone = "good" | "low" | "high";

/** Whether a status is fine for that nutrient: kcal wants the band, protein is a floor (over = fine), net carbs a cap (under = fine). */
export function tone(n: Nutrient, s: Status): Tone {
  if (s === "on") return "good";
  if (n === "protein") return s === "over" ? "good" : "low";
  if (n === "netCarbs") return s === "under" ? "good" : "high";
  return s === "under" ? "low" : "high";
}

// ── Long views (3 months / 6 months / 1 year) — data from GET /api/food-log/summary (per-day totals only) ──

export type LongView = "3m" | "6m" | "1y";
export const LONG_MONTHS: Record<LongView, number> = { "3m": 3, "6m": 6, "1y": 12 };
export const isLongView = (v: View): v is LongView => v === "3m" || v === "6m" || v === "1y";

/** The calendar months ending with the month of `day` (3m = that month + the 2 before). Always ≤ 366 days. */
export function periodRange(view: LongView, day: string): { from: string; to: string } {
  const from = shiftMonth(day, -(LONG_MONTHS[view] - 1));
  const to = addDays(shiftMonth(day, 1), -1);
  return { from, to };
}

/** A day inside the period `n` periods away (‹ › move by the whole period length). */
export const shiftPeriod = (view: LongView, day: string, n: number) => shiftMonth(day, n * LONG_MONTHS[view]);

/** Every day from `from` to `to` inclusive. */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** One row of Prisma `foodLog.groupBy({ by: ["date"], _sum, _count })` → a DayTotal (null sums → 0). */
export interface DayGroup { date: Date; _sum: { kcal: number | null; protein: number | null; netCarbs: number | null; fat: number | null }; _count: { _all: number } }
export function groupsToDays(groups: DayGroup[]): DayTotal[] {
  return groups
    .map((g) => ({ date: g.date.toISOString().slice(0, 10), kcal: g._sum.kcal ?? 0, protein: g._sum.protein ?? 0, netCarbs: g._sum.netCarbs ?? 0, fat: g._sum.fat ?? 0, entries: g._count._all }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export interface Bucket extends RangeSummary { key: string; from: string; to: string }

/**
 * Group filled days (one per calendar day, oldest first) into weeks (Mon-start, clipped to the range) or
 * calendar months. Each bucket carries the summarise() of its days: `of` = its days inside the range,
 * `logged` = those with ≥ 1 entry, `avg` over logged days only.
 */
export function bucketDays(days: DayTotal[], by: "week" | "month"): Bucket[] {
  const groups = new Map<string, DayTotal[]>();
  for (const d of days) {
    const k = by === "week" ? weekDays(d.date)[0] : d.date.slice(0, 7);
    const g = groups.get(k);
    if (g) g.push(d);
    else groups.set(k, [d]);
  }
  return [...groups.entries()].map(([key, ds]) => ({ key, from: ds[0].date, to: ds[ds.length - 1].date, ...summarise(ds) }));
}
