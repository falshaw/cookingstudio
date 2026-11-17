// Faster food log : copy a day or one meal, recent foods, log USDA grams.
// Pure — unit-tested in tests/food-log.test.ts. Values are kept unrounded; only the UI rounds.
import { sumMacros, type Per100 } from "./nutrition";

export const MEALS = ["breakfast", "lunch", "dinner", "snack"] as const;
export type Meal = (typeof MEALS)[number];

/** The FoodLog columns a copy carries over (userId + date are set by the caller, server-side). */
export interface LogRow { meal: string; label: string; recipeId: string | null; portions: number; kcal: number; protein: number; netCarbs: number; fat: number }

const sameFood = (a: LogRow, b: LogRow) => a.meal === b.meal && a.label === b.label && Math.abs(a.kcal - b.kcal) < 0.05;

/**
 * Rows to create when copying `source` (one day; only `meal` when given) onto a day that already holds
 * `existing`. An entry already on the target day (same meal, label, kcal) is skipped one-for-one, so a
 * double tap does not log the day twice, while two identical entries in the source (two eggs) both copy.
 */
export function copyRows(source: LogRow[], existing: LogRow[], meal?: string): { rows: LogRow[]; skipped: number } {
  const pool = [...existing];
  const rows: LogRow[] = [];
  let skipped = 0;
  for (const s of source) {
    if (meal && s.meal !== meal) continue;
    const hit = pool.findIndex((e) => sameFood(e, s));
    if (hit >= 0) {
      pool.splice(hit, 1);
      skipped++;
      continue;
    }
    rows.push({ meal: s.meal, label: s.label, recipeId: s.recipeId, portions: s.portions, kcal: s.kcal, protein: s.protein, netCarbs: s.netCarbs, fat: s.fat });
  }
  return { rows, skipped };
}

export interface RecentFood { entryId: string; label: string; meal: string; kcal: number; protein: number; netCarbs: number; fat: number; uses: number; lastDate: string }

const foodKey = (label: string) => label.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Distinct foods from the given entries (the caller passes the last 14 days), newest first. Same label =
 * same food (the label carries the portion: "Egg 100 g", "Bolognese × 2"), so re-logging repeats that
 * portion; the newest entry's numbers win.
 */
export function recentFoods(entries: (LogRow & { id: string; date: Date; createdAt: Date })[], limit = 12): RecentFood[] {
  const sorted = [...entries].sort((a, b) => b.date.getTime() - a.date.getTime() || b.createdAt.getTime() - a.createdAt.getTime());
  const out = new Map<string, RecentFood>();
  for (const e of sorted) {
    const k = foodKey(e.label);
    const seen = out.get(k);
    if (seen) {
      seen.uses++;
      continue;
    }
    out.set(k, { entryId: e.id, label: e.label, meal: e.meal, kcal: e.kcal, protein: e.protein, netCarbs: e.netCarbs, fat: e.fat, uses: 1, lastDate: e.date.toISOString().slice(0, 10) });
  }
  return [...out.values()].slice(0, limit);
}

/** kcal + macros for `grams` of a USDA per-100 g row (net carbs = carbs − fibre, floored at 0). Unrounded. */
export function macrosForGrams(ref: Per100, grams: number): { kcal: number; protein: number; netCarbs: number; fat: number } {
  const m = sumMacros([{ grams, ref }]);
  return { kcal: m.kcal, protein: m.protein, netCarbs: m.netCarbs, fat: m.fat };
}

export interface EntryPatch { meal?: string; date?: string; portions?: number; label?: string }
export interface EditableEntry extends LogRow { date: Date; planKey: string | null }

/** " × 2" suffix the log puts on a label when portions ≠ 1 (POST /api/food-log). */
const PORTION_SUFFIX = / × \d+(?:\.\d+)?$/;

/**
 * The columns an edit changes. New portions scale kcal + macros by new ÷ old (they were stored for the old
 * portions) and rewrite the " × n" suffix; a moved entry (other meal or day) loses its plan link, so
 * "Ate today's plan" can log that slot again. Unrounded, like every other path.
 */
export function editedEntry(e: EditableEntry, p: EntryPatch): Partial<Omit<EditableEntry, "recipeId">> {
  const out: Partial<Omit<EditableEntry, "recipeId">> = {};
  let base = (p.label?.trim() || e.label).replace(PORTION_SUFFIX, "");
  if (p.portions != null && p.portions !== e.portions) {
    const f = p.portions / (e.portions || 1);
    Object.assign(out, { portions: p.portions, kcal: e.kcal * f, protein: e.protein * f, netCarbs: e.netCarbs * f, fat: e.fat * f });
  }
  const portions = out.portions ?? e.portions;
  if (p.label != null || out.portions != null) {
    base = base.trim();
    out.label = `${base}${portions !== 1 ? ` × ${portions}` : ""}`;
  }
  if (p.meal && p.meal !== e.meal) out.meal = p.meal;
  if (p.date && p.date !== e.date.toISOString().slice(0, 10)) out.date = new Date(`${p.date}T00:00:00Z`);
  if ((out.meal || out.date) && e.planKey) out.planKey = null;
  return out;
}

export interface DayTotal { date: string; kcal: number; protein: number; netCarbs: number; fat: number; entries: number }

/** Sum per day (rows already carry date as YYYY-MM-DD), in the order the days first appear. Unrounded. */
export function dayTotals(rows: { date: string; kcal: number; protein: number; netCarbs: number; fat: number }[]): DayTotal[] {
  const by = new Map<string, DayTotal>();
  for (const r of rows) {
    const d = by.get(r.date) ?? { date: r.date, kcal: 0, protein: 0, netCarbs: 0, fat: 0, entries: 0 };
    d.kcal += r.kcal;
    d.protein += r.protein;
    d.netCarbs += r.netCarbs;
    d.fat += r.fat;
    d.entries += 1;
    by.set(r.date, d);
  }
  return [...by.values()];
}
