// Weekly numbers per person, computed in CODE from what was eaten (food log) on logged days and the meal
// plan on the others:
// nutrient gaps (USDA micros vs reference intakes), glycemic load (static GI table), macros, fish.
// No medical claims — reference intakes are population values, shown for orientation only.
import { prisma } from "./prisma";
import { isOmega3Portion } from "./rules";
import { ruleLines } from "./recipe-data";
import { weekStart } from "./utils";

/** Reference-intake groups a person can pick on Profiles (UserProfile.referenceGroup). "general" = the higher
 *  of the two adult values, so nobody is told they are covered when they might not be. */
export const REFERENCE_GROUPS = ["general", "male", "female"] as const;
export type ReferenceGroup = (typeof REFERENCE_GROUPS)[number];

/** Adult reference intakes per day. Sources: EFSA Dietary Reference Values (AI/PRI); US NIH RDA/AI where noted. */
export const REFERENCE: Record<string, { label: string; unit: string; values: Record<ReferenceGroup, number>; source: string }> = {
  b12: { label: "Vitamin B12", unit: "µg", values: { general: 4, male: 4, female: 4 }, source: "EFSA AI" },
  iron: { label: "Iron", unit: "mg", values: { general: 16, male: 11, female: 16 }, source: "EFSA PRI (female value = before menopause)" },
  zinc: { label: "Zinc", unit: "mg", values: { general: 11, male: 11, female: 8 }, source: "US NIH RDA" },
  ala: { label: "Omega-3 ALA", unit: "g", values: { general: 1.6, male: 1.6, female: 1.1 }, source: "US NIH AI" },
  magnesium: { label: "Magnesium", unit: "mg", values: { general: 350, male: 350, female: 300 }, source: "EFSA AI" },
  vitD: { label: "Vitamin D (from food)", unit: "µg", values: { general: 15, male: 15, female: 15 }, source: "EFSA AI — most vitamin D comes from sunlight, not food" },
  fibre: { label: "Fibre", unit: "g", values: { general: 25, male: 25, female: 25 }, source: "EFSA AI" },
};

/** A profile's reference group; anything unknown or unset falls back to "general". */
export function referenceGroup(raw: string | null | undefined): ReferenceGroup {
  return (REFERENCE_GROUPS as readonly string[]).includes(raw ?? "") ? (raw as ReferenceGroup) : "general";
}

/**
 * Glycemic index (glucose = 100) for the carb foods in this app, from the International Tables of
 * GI values (Atkinson, Foster-Powell & Brand-Miller 2008, Diabetes Care 31:2281) / Sydney GI database.
 * Foods not listed get NO GI — their carbs are reported as "not counted", never estimated.
 */
export const GI: Record<string, number> = {
  "basmati-rice": 58,
  "arborio-rice": 69,
  spaghetti: 49,
  "sourdough-bread": 54,
  breadcrumbs: 75,
  potato: 78,
  chickpeas: 38,
  "kidney-beans": 52,
  "white-beans": 31,
  quinoa: 53,
  carrot: 39,
  peas: 51,
  pumpkin: 64,
  milk: 39,
};

export const glMealBand = (gl: number) => (gl <= 10 ? "low" : gl < 20 ? "medium" : "high");
export const glDayBand = (gl: number) => (gl < 80 ? "green" : gl <= 120 ? "amber" : "red");

type Ref = { carbs: number; fibre: number | null; protein: number; fat: number; satFat: number | null; kcal: number; sugar?: number | null; b12: number | null; iron: number | null; zinc: number | null; ala: number | null; magnesium: number | null; vitD: number | null; epa?: number | null; dha?: number | null; mufa?: number | null; pufa?: number | null };

/** Glycemic load of one person's portion: only GI-listed foods count; the rest is reported, not guessed. */
export function portionGl(lines: { component: string; grams: number; slug: string; ref: { carbs: number; fibre: number | null } | null }[], servings: number, who: string | null, pf = 1): { gl: number | null; uncounted: number } {
  let gl = 0, uncounted = 0, listed = false;
  for (const l of lines) {
    if (l.component !== "both" && l.component !== who) continue;
    if (!l.ref) continue;
    const g = l.component === "both" ? (l.grams * pf) / Math.max(1, servings) : l.grams * pf;
    const avail = Math.max(0, l.ref.carbs - (l.ref.fibre ?? 0)) * (g / 100);
    const gi = GI[l.slug];
    if (gi != null) {
      gl += (gi * avail) / 100;
      listed = true;
    } else uncounted += avail;
  }
  return { gl: listed ? Math.round(gl * 10) / 10 : null, uncounted: Math.round(uncounted) };
}

/** Where a day's numbers come from: the food log when that day has entries, else the meal plan. */
export type DaySource = "logged" | "planned" | "none";

export interface MealStats {
  meal: string;
  title: string;
  gl: number;
  uncountedCarbs: number;
  netCarbs: number;
  protein: number;
  /** null when this meal holds a logged food without a recipe (USDA grams / photo) — fibre etc. not known */
  fibre: number | null;
  satFat: number | null;
  /** every food in it has a recipe → fibre, sugar, sat fat, micros and GL are counted */
  detailed: boolean;
  /** a frozen-sauce plan slot (only the sauce, the fresh side is not in the plan) */
  freezer: boolean;
  fish: boolean;
}

export interface DayStats {
  day: number;
  date: string;
  source: DaySource;
  /** logged day with foods that have no recipe: only kcal / protein / net carbs / fat are known for those */
  partial: boolean;
  meals: MealStats[];
  gl: number;
  uncountedCarbs: number;
  nutrients: Record<string, number>;
  netCarbs: number;
  protein: number;
  fibre: number;
  satFat: number;
  sugar: number;
  alcoholG: number;
  epaDha: number;
  ala: number;
  unsatFat: number;
}

export interface WeekStats {
  /** kept for callers: true when the week has a plan OR any logged day */
  hasPlan: boolean;
  days: DayStats[];
  /** per main meal (snacks left out); fibre / sat fat / GL only over meals with full recipe detail */
  avgPerMeal: { netCarbs: number; protein: number; fibre: number | null; satFat: number | null; gl: number | null; n: number; nDetailed: number } | null;
  /** daily nutrient averages over days with full detail (planned days + fully-detailed logged days) */
  dailyAvg: Record<string, number>;
  fish: number;
  /** daily averages: net carbs over every counted day, the rest only over fully-detailed days (null if none) */
  perDay: { netCarbs: number; sugar: number | null; fibre: number | null; satFat: number | null; unsatFat: number | null; epaDha: number | null; ala: number | null; alcoholG: number | null } | null;
  /** how many days of the week came from the food log / the plan; partial = logged days missing detail */
  logged: number;
  planned: number;
  partialDays: number;
  /** days the nutrient averages are based on */
  detailDays: number;
}

type RecipeRow = { id: string; title: string; servings: number; ingredients: { component: string; grams: number; ingredient: { slug: string; fdcId: number | null; isMeat: boolean; isFish: boolean; isOmega3: boolean; isAlcohol: boolean; isAddedSugar: boolean; isRefinedStarch: boolean; nameEn: string } }[] };
type LogEntry = { date: Date; meal: string; label: string; recipeId: string | null; portions: number; netCarbs: number; protein: number };

const NUTRIENT_KEYS = ["b12", "iron", "zinc", "ala", "magnesium", "vitD"] as const;

/** One person's portion of a recipe × `scale` (pf × portions), added into `day`. Returns the meal's numbers. */
function addRecipe(day: DayStats, r: RecipeRow, who: string, scale: number, refs: Map<number, Ref>) {
  let gl = 0, uncounted = 0, nc = 0, pr = 0, fi = 0, sf = 0;
  for (const l of r.ingredients) {
    if (l.component !== "both" && l.component !== who) continue;
    const g = l.component === "both" ? (l.grams * scale) / Math.max(1, r.servings) : l.grams * scale;
    const ref = l.ingredient.fdcId != null ? refs.get(l.ingredient.fdcId) : undefined;
    if (!ref) continue;
    const k = g / 100;
    const avail = Math.max(0, ref.carbs - (ref.fibre ?? 0)) * k;
    nc += avail;
    pr += ref.protein * k;
    fi += (ref.fibre ?? 0) * k;
    sf += (ref.satFat ?? 0) * k;
    day.sugar += (ref.sugar ?? 0) * k;
    day.epaDha += ((ref.epa ?? 0) + (ref.dha ?? 0)) * k;
    day.ala += (ref.ala ?? 0) * k;
    day.unsatFat += ((ref.mufa ?? 0) + (ref.pufa ?? 0)) * k;
    if (l.ingredient.isAlcohol) day.alcoholG += g;
    const gi = GI[l.ingredient.slug];
    if (gi != null) gl += (gi * avail) / 100;
    else uncounted += avail;
    for (const key of NUTRIENT_KEYS) day.nutrients[key] = (day.nutrients[key] ?? 0) + (ref[key] ?? 0) * k;
    day.nutrients.fibre = (day.nutrients.fibre ?? 0) + (ref.fibre ?? 0) * k;
  }
  return { gl, uncounted, nc, pr, fi, sf };
}

const emptyDay = (d: number, date: string, source: DaySource): DayStats => ({ day: d, date, source, partial: false, meals: [], gl: 0, uncountedCarbs: 0, nutrients: {}, netCarbs: 0, protein: 0, fibre: 0, satFat: 0, sugar: 0, alcoholG: 0, epaDha: 0, ala: 0, unsatFat: 0 });

/**
 * Pure week maths. Per day: the food log when that day has entries (recipe entries = full USDA detail of my
 * portion × portions; other entries = their stored kcal/protein/net carbs/fat only — nothing invented), else
 * the plan slots. Unit-tested in tests/health-logged.test.ts.
 */
export function computeWeek(input: {
  who: string;
  pf: number;
  weekStart: string;
  slots: { day: number; meal: string; recipeId: string; source?: string }[];
  logs: LogEntry[];
  recipes: RecipeRow[];
  refs: Map<number, Ref>;
}): WeekStats {
  const { who, pf, refs } = input;
  const recipeById = new Map(input.recipes.map((r) => [r.id, r]));
  const days: DayStats[] = [];
  let fish = 0;
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.parse(`${input.weekStart}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
    const dayLogs = input.logs.filter((l) => l.date.toISOString().slice(0, 10) === date);
    const daySlots = input.slots.filter((s) => s.day === d);
    const day = emptyDay(d, date, dayLogs.length ? "logged" : daySlots.length ? "planned" : "none");
    if (day.source === "logged") {
      for (const meal of [...new Set(dayLogs.map((l) => l.meal))]) {
        const entries = dayLogs.filter((l) => l.meal === meal);
        const ms: MealStats = { meal, title: entries.map((e) => e.label).join(", "), gl: 0, uncountedCarbs: 0, netCarbs: 0, protein: 0, fibre: 0, satFat: 0, detailed: true, freezer: false, fish: false };
        for (const e of entries) {
          // the stored macros are what was logged; the recipe adds fibre / sugar / fat quality / micros / GL
          ms.netCarbs += e.netCarbs;
          ms.protein += e.protein;
          const r = e.recipeId ? recipeById.get(e.recipeId) : undefined;
          if (!r) {
            ms.detailed = false;
            ms.uncountedCarbs += e.netCarbs;
            continue;
          }
          const a = addRecipe(day, r, who, e.portions, refs);
          ms.gl += a.gl;
          ms.uncountedCarbs += a.uncounted;
          ms.fibre! += a.fi;
          ms.satFat! += a.sf;
          if (isOmega3Portion(ruleLines(r.ingredients), who)) ms.fish = true;
        }
        if (!ms.detailed) {
          day.partial = true;
          ms.fibre = null;
          ms.satFat = null;
        }
        if (ms.fish) fish++;
        day.gl += ms.gl;
        day.uncountedCarbs += ms.uncountedCarbs;
        day.netCarbs += ms.netCarbs;
        day.protein += ms.protein;
        day.fibre += ms.fibre ?? 0;
        day.satFat += ms.satFat ?? 0;
        day.meals.push({ ...ms, gl: Math.round(ms.gl), uncountedCarbs: Math.round(ms.uncountedCarbs) });
      }
    } else {
      for (const s of daySlots) {
        const r = recipeById.get(s.recipeId);
        if (!r) continue;
        const isFish = isOmega3Portion(ruleLines(r.ingredients), who);
        if (isFish) fish++;
        const a = addRecipe(day, r, who, pf, refs);
        day.meals.push({ meal: s.meal, title: r.title, gl: Math.round(a.gl), uncountedCarbs: Math.round(a.uncounted), netCarbs: a.nc, protein: a.pr, fibre: a.fi, satFat: a.sf, detailed: true, freezer: s.source === "freezer", fish: isFish });
        day.gl += a.gl;
        day.uncountedCarbs += a.uncounted;
        day.netCarbs += a.nc;
        day.protein += a.pr;
        day.fibre += a.fi;
        day.satFat += a.sf;
      }
    }
    day.gl = Math.round(day.gl);
    day.uncountedCarbs = Math.round(day.uncountedCarbs);
    days.push(day);
  }
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const counted = days.filter((d) => d.meals.length);
  const detail = counted.filter((d) => !d.partial);
  const avgOver = (list: DayStats[], f: (d: DayStats) => number) => (list.length ? list.reduce((a, d) => a + f(d), 0) / list.length : 0);
  const dailyAvg: Record<string, number> = {};
  for (const key of Object.keys(REFERENCE)) dailyAvg[key] = avgOver(detail, (d) => d.nutrients[key] ?? 0);
  const orNull = (v: number) => (detail.length ? v : null);
  const perDay = counted.length
    ? {
        netCarbs: r1(avgOver(counted, (d) => d.netCarbs)),
        sugar: orNull(r1(avgOver(detail, (d) => d.sugar))),
        fibre: orNull(r1(avgOver(detail, (d) => d.fibre))),
        satFat: orNull(r1(avgOver(detail, (d) => d.satFat))),
        unsatFat: orNull(r1(avgOver(detail, (d) => d.unsatFat))),
        epaDha: orNull(r2(avgOver(detail, (d) => d.epaDha))),
        ala: orNull(r2(avgOver(detail, (d) => d.ala))),
        alcoholG: orNull(r1(avgOver(detail, (d) => d.alcoholG))),
      }
    : null;
  // per MAIN meal: snacks are part of the day totals, not a meal; frozen-sauce plan slots are only the sauce
  const mains = counted.flatMap((d) => d.meals).filter((m) => m.meal !== "snack" && !m.freezer);
  const full = mains.filter((m) => m.detailed);
  const mean = (list: MealStats[], f: (m: MealStats) => number) => r1(list.reduce((a, m) => a + f(m), 0) / list.length);
  return {
    hasPlan: counted.length > 0,
    days,
    fish,
    perDay,
    dailyAvg,
    avgPerMeal: mains.length
      ? { netCarbs: mean(mains, (m) => m.netCarbs), protein: mean(mains, (m) => m.protein), fibre: full.length ? mean(full, (m) => m.fibre ?? 0) : null, satFat: full.length ? mean(full, (m) => m.satFat ?? 0) : null, gl: full.length ? mean(full, (m) => m.gl) : null, n: mains.length, nDetailed: full.length }
      : null,
    logged: days.filter((d) => d.source === "logged").length,
    planned: days.filter((d) => d.source === "planned").length,
    partialDays: days.filter((d) => d.partial).length,
    detailDays: detail.length,
  };
}

/** "3 days logged · 4 planned" — the label every health number carries. */
export function sourceLabel(s: { logged: number; planned: number }): string {
  if (!s.logged && !s.planned) return "no data";
  if (!s.logged) return `planned (${s.planned} day${s.planned === 1 ? "" : "s"})`;
  if (!s.planned) return `logged (${s.logged} day${s.logged === 1 ? "" : "s"})`;
  return `${s.logged} day${s.logged === 1 ? "" : "s"} logged · ${s.planned} planned`;
}

export async function weekStats(user: { id?: string; slug: string; profile: { portionFactor: number } | null }, ws: Date = weekStart(new Date())): Promise<WeekStats> {
  const wsDay = ws.toISOString().slice(0, 10);
  const end = new Date(ws.getTime() + 7 * 86_400_000);
  const [plan, logs] = await Promise.all([
    prisma.mealPlan.findUnique({ where: { weekStart: ws }, include: { slots: true } }),
    // the food log is private: only this person's own entries, never the partner's
    user.id ? prisma.foodLog.findMany({ where: { userId: user.id, date: { gte: ws, lt: end } }, select: { date: true, meal: true, label: true, recipeId: true, portions: true, netCarbs: true, protein: true } }) : Promise.resolve([] as LogEntry[]),
  ]);
  const slots = plan?.slots ?? [];
  const ids = [...new Set([...slots.map((s) => s.recipeId), ...logs.map((l) => l.recipeId).filter((x): x is string => !!x)])];
  const recipes = ids.length ? await prisma.recipe.findMany({ where: { id: { in: ids } }, include: { ingredients: { include: { ingredient: true } } } }) : [];
  const fdc = [...new Set(recipes.flatMap((r) => r.ingredients.map((i) => i.ingredient.fdcId)).filter((x): x is number => x != null))];
  const refs = new Map((fdc.length ? await prisma.nutritionRef.findMany({ where: { fdcId: { in: fdc } } }) : []).map((r) => [r.fdcId, r as Ref]));
  return computeWeek({ who: user.slug, pf: user.profile?.portionFactor ?? 1, weekStart: wsDay, slots, logs, recipes, refs });
}

/** Trailing 7-day mean for each weight entry (entries within the 7 days ending that date). */
export function smoothWeights(entries: { date: string; kg: number }[]): { date: string; kg: number; trend: number }[] {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((e) => {
    const t = new Date(e.date).getTime();
    const win = sorted.filter((x) => { const xt = new Date(x.date).getTime(); return xt <= t && xt > t - 7 * 86_400_000; });
    return { ...e, trend: Math.round((win.reduce((a, x) => a + x.kg, 0) / win.length) * 10) / 10 };
  });
}

export interface TimelineRow {
  week: string; // Monday, YYYY-MM-DD
  perDay: WeekStats["perDay"];
  fish: number;
  /** days of that week from the food log / from the plan */
  logged: number;
  planned: number;
  labs: { marker: string; value: number | null; unit: string; date: string }[];
}

/**
 * Food ↔ lab timeline for one person: weekly intake averages (food log where logged, else the plan) next to
 * the lab values measured that week. Patterns to look at with a doctor — not causes.
 */
export async function foodLabTimeline(user: { id: string; slug: string; profile: { portionFactor: number } | null }): Promise<TimelineRow[]> {
  const [plans, logDays, labs] = await Promise.all([
    prisma.mealPlan.findMany({ select: { weekStart: true }, orderBy: { weekStart: "asc" } }),
    prisma.foodLog.findMany({ where: { userId: user.id }, select: { date: true }, distinct: ["date"] }),
    prisma.labResult.findMany({ where: { userId: user.id, date: { not: null } }, orderBy: { date: "asc" } }),
  ]);
  const weeks = new Map<string, TimelineRow>();
  const key = (d: Date) => weekStart(d).toISOString().slice(0, 10);
  const starts = new Map<string, Date>();
  for (const p of plans) starts.set(key(p.weekStart), weekStart(p.weekStart));
  for (const l of logDays) starts.set(key(l.date), weekStart(l.date));
  for (const [k, ws] of starts) {
    const st = await weekStats(user, ws);
    weeks.set(k, { week: k, perDay: st.perDay, fish: st.fish, logged: st.logged, planned: st.planned, labs: [] });
  }
  for (const l of labs) {
    const k = key(l.date!);
    const row = weeks.get(k) ?? { week: k, perDay: null, fish: 0, logged: 0, planned: 0, labs: [] };
    row.labs.push({ marker: l.marker, value: l.value, unit: l.unit, date: l.date!.toISOString().slice(0, 10) });
    weeks.set(k, row);
  }
  return [...weeks.values()].sort((a, b) => b.week.localeCompare(a.week));
}

export interface GapFood {
  ingredientId: string;
  slug: string;
  nameEn: string;
  
  per100g: number;
  unit: string;
}

/**
 * Foods from the ingredient guide that are rich in a nutrient AND fit the person's rules
 * (vegetarian, avoid list, alcohol, added sugar). Spices/herbs are left out (eaten in tiny amounts).
 */
export async function gapFoods(nutrient: string, rules: { vegetarian: boolean; avoidFoods: string[]; noAlcohol: boolean; noAddedSugar: boolean }, limit = 5): Promise<GapFood[]> {
  const ref = REFERENCE[nutrient];
  if (!ref) return [];
  const { matchesFood } = await import("./rules");
  const ings = await prisma.ingredient.findMany({ where: { fdcId: { not: null }, kind: { notIn: ["spice", "herb"] } } });
  const refs = new Map((await prisma.nutritionRef.findMany({ where: { fdcId: { in: ings.map((i) => i.fdcId!) } } })).map((r) => [r.fdcId, r as unknown as Record<string, number | null>]));
  const field = nutrient === "fibre" ? "fibre" : nutrient;
  return ings
    .filter((i) => !(rules.vegetarian && (i.isMeat || i.isFish)))
    .filter((i) => !(rules.noAlcohol && i.isAlcohol) && !(rules.noAddedSugar && i.isAddedSugar))
    .filter((i) => !rules.avoidFoods.some((t) => matchesFood(i.slug, i.nameEn, t)))
    .map((i) => ({ ingredientId: i.id, slug: i.slug, nameEn: i.nameEn, per100g: Number(refs.get(i.fdcId!)?.[field] ?? 0), unit: ref.unit }))
    .filter((f) => f.per100g > 0)
    .sort((a, b) => b.per100g - a.per100g)
    .slice(0, limit);
}
