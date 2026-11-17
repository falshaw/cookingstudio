// Pure helpers for the neon dashboard. Tested in tests/dashboard.test.ts.

const MEAL_ORDER = ["breakfast", "lunch", "dinner"] as const;

export interface DaySlot { meal: string; logged: boolean }

/** Meal that belongs to this hour of the day: breakfast until 11:00, lunch until 15:00, then dinner. */
export function mealForHour(hour: number): number {
  return hour < 11 ? 0 : hour < 15 ? 1 : 2;
}

/**
 * Which of today's meals is the big one on the dashboard: the meal of this time of day or the next one after it that
 * is not eaten yet (at 18:00 that is dinner, even when breakfast was never logged); if those are all eaten, the last
 * earlier meal still open; if everything is logged, the last meal of the day.
 */
export function pickHeroMeal<T extends DaySlot>(slots: T[], hour: number): T | null {
  const idx = (s: T) => MEAL_ORDER.indexOf(s.meal as (typeof MEAL_ORDER)[number]);
  const ordered = [...slots].sort((a, b) => idx(a) - idx(b));
  if (!ordered.length) return null;
  const from = mealForHour(hour);
  return (
    ordered.find((s) => !s.logged && idx(s) >= from) ??
    [...ordered].reverse().find((s) => !s.logged) ??
    ordered[ordered.length - 1]
  );
}

export function heroLabel(meal: string): string {
  return meal === "dinner" ? "Tonight" : meal === "lunch" ? "Lunch today" : meal === "breakfast" ? "Breakfast today" : "Today";
}

function prevDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Days in a row with at least one cook, counted back from today — or from yesterday when today has none yet. */
export function cookStreak(cookDays: Iterable<string>, today: string): number {
  const days = new Set(cookDays);
  let d = days.has(today) ? today : prevDay(today);
  let n = 0;
  while (days.has(d)) {
    n++;
    d = prevDay(d);
  }
  return n;
}

/** stroke-dashoffset for a ring of circumference `c`: empty at 0, full at target (or above). No target = full ring. */
export function ringOffset(value: number, target: number | null | undefined, c = 327): number {
  if (!target || target <= 0) return 0;
  return Math.round(c * (1 - Math.min(1, Math.max(0, value / target))));
}
