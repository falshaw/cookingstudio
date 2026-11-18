// Diet rule engine. Runs in CODE after every LLM call (plan, teach-me, URL import) and on every
// plan/swap — a model output that fails is rejected and regenerated. All rules come from the
// person's profile; nothing here is hard-coded per person. Pure — tested in tests/rules.test.ts.
import type { Macros } from "./nutrition";

export interface RuleProfile {
  /** user id: matches RuleLine.forUserId */
  id: string;
  slug: string;
  name: string;
  vegetarian: boolean;
  vegBreakfastAllowed: string[];
  avoidFoods: string[];
  noAlcohol: boolean;
  noAddedSugar: boolean;
  noRefinedStarch: boolean;
  maxNetCarbsPerMeal: number | null;
  minProteinPerMeal: number | null;
  maxCookMinutes: number | null;
  /** stricter limit for a fresh lunch (e.g. lunch must be quick); null = maxCookMinutes */
  maxLunchMinutes?: number | null;
  omega3MinPerWeek: number | null;
  omega3MaxPerWeek: number | null;
  /** "red meat at most N× a week"; null/undefined = no limit */
  redMeatMaxPerWeek?: number | null;
  /** recipes this person disliked (👎) — never planned for them, so never as a shared meal */
  dislikedRecipeIds?: string[];
  /** exceptions to avoidFoods, e.g. coconut milk allowed in curries */
  avoidExceptions?: AvoidException[];
}

export interface AvoidException {
  allow: string; // ingredient slug (or food term) that is allowed…
  contexts: string[]; // …only when the recipe is one of these (cuisine / tag / sauce family / title words)
  note?: string;
}

/** What a recipe "is" for exception checks. */
export interface RecipeContext {
  title?: string;
  cuisine?: string;
  tags?: string[];
  sauceFamily?: string | null;
}

/** True when this line is on the avoid list but allowed here (e.g. coconut milk in a Thai curry). */
export function isAvoidExcepted(p: RuleProfile, line: { slug: string; nameEn: string }, ctx?: RecipeContext): boolean {
  if (!ctx || !p.avoidExceptions?.length) return false;
  const hay = [ctx.title, ctx.cuisine, ctx.sauceFamily, ...(ctx.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
  return p.avoidExceptions.some((e) => (line.slug === e.allow || matchesFood(line.slug, line.nameEn, e.allow)) && e.contexts.some((c) => hay.includes(c.toLowerCase())));
}

/** The avoid term this line hits for this person, or null (not on the list, or allowed here by an exception). */
export function avoidTermFor(p: RuleProfile, line: { slug: string; nameEn: string }, ctx?: RecipeContext): string | null {
  const term = p.avoidFoods.find((t) => matchesFood(line.slug, line.nameEn, t));
  return term && !isAvoidExcepted(p, line, ctx) ? term : null;
}

export interface RuleLine {
  slug: string;
  nameEn: string;
  /** null = shared base, else the user id whose own extra this line is */
  forUserId: string | null;
  grams: number;
  isMeat: boolean;
  isFish: boolean;
  isOmega3: boolean;
  isAlcohol: boolean;
  isAddedSugar: boolean;
  isRefinedStarch: boolean;
}

export interface PortionInput {
  title: string;
  meal: string; // breakfast | lunch | dinner | any
  totalMinutes: number;
  /** cooked earlier in a prep session or leftovers → the time limit does not apply tonight */
  precooked?: boolean;
  lines: RuleLine[];
  macros: Macros;
  /** recipe context for avoid-food exceptions */
  context?: RecipeContext;
}

export interface Issue {
  level: "fail" | "warn";
  code: string;
  /** slug of the person it concerns, or "household" */
  who: string;
  msg: string;
}

/** Does an ingredient slug match an avoid term ("milk" matches "milk", not "milkfish"). */
export function matchesFood(slug: string, nameEn: string, term: string): boolean {
  const t = term
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!t) return false;
  const s = `-${slug.toLowerCase()}-`;
  // parentheticals are notes ("courgette (or marrow)"), not the food itself
  const n = `-${nameEn.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, "-")}-`;
  return s.includes(`-${t}-`) || n.includes(`-${t}-`);
}

/** The lines on one person's plate: the shared base plus their own extras. */
export function linesFor(lines: RuleLine[], personId: string): RuleLine[] {
  return lines.filter((l) => l.forUserId == null || l.forUserId === personId);
}

export function checkPortion(p: RuleProfile, input: PortionInput): Issue[] {
  const issues: Issue[] = [];
  const who = p.slug;
  const mine = linesFor(input.lines, p.id).filter((l) => l.grams > 0);
  const add = (level: Issue["level"], code: string, msg: string) =>
    issues.push({ level, code, who, msg: `${p.name}: ${msg}` });

  if (p.vegetarian) {
    for (const l of mine) {
      if (!(l.isMeat || l.isFish)) continue;
      const allowed = input.meal === "breakfast" && p.vegBreakfastAllowed.includes(l.slug);
      if (!allowed) add("fail", "vegetarian", `${l.nameEn} is meat/fish in a vegetarian portion (${input.title})`);
    }
  }
  for (const term of p.avoidFoods) {
    for (const l of mine) if (matchesFood(l.slug, l.nameEn, term) && !isAvoidExcepted(p, l, input.context)) add("fail", "avoid", `${l.nameEn} is on the avoid list (${term})`);
  }
  if (p.noAlcohol) for (const l of mine) if (l.isAlcohol) add("fail", "alcohol", `${l.nameEn} contains alcohol`);
  if (p.noAddedSugar) for (const l of mine) if (l.isAddedSugar) add("fail", "sugar", `${l.nameEn} is added sugar`);
  if (p.noRefinedStarch)
    for (const l of mine) if (l.isRefinedStarch) add("warn", "starch", `${l.nameEn} is white rice/bread/pasta — keep it small or swap`);
  if (p.maxNetCarbsPerMeal != null && input.macros.netCarbs > p.maxNetCarbsPerMeal + 1e-9)
    add("fail", "netcarbs", `${input.macros.netCarbs.toFixed(1)} g net carbs > ${p.maxNetCarbsPerMeal} g (${input.title})`);
  if (p.minProteinPerMeal != null && input.macros.protein < p.minProteinPerMeal - 1e-9)
    add("fail", "protein", `only ${input.macros.protein.toFixed(1)} g protein, needs ${p.minProteinPerMeal} g (${input.title})`);
  const limit = input.meal === "lunch" && p.maxLunchMinutes != null ? Math.min(p.maxLunchMinutes, p.maxCookMinutes ?? Infinity) : p.maxCookMinutes;
  if (limit != null && !input.precooked && input.totalMinutes > limit)
    add("fail", "time", `${input.totalMinutes} min > ${limit} min ${input.meal === "lunch" && p.maxLunchMinutes != null ? "lunch " : ""}limit (${input.title})`);
  if (input.macros.unknownGrams > 0)
    add("warn", "nutrition", `${Math.round(input.macros.unknownGrams)} g of ingredients have no USDA data — macros are a lower bound`);
  return issues;
}

/** Hard ingredient rules only (no macro/time) — used for lesson recipes from teach-me / import. */
export function checkIngredientsOnly(p: RuleProfile, title: string, lines: RuleLine[], context?: RecipeContext): Issue[] {
  return checkPortion(
    { ...p, maxNetCarbsPerMeal: null, minProteinPerMeal: null, maxCookMinutes: null, maxLunchMinutes: null, vegetarian: false },
    { title, meal: "any", totalMinutes: 0, lines, context: context ?? { title }, macros: { kcal: 0, protein: 0, carbs: 0, netCarbs: 0, fat: 0, satFat: 0, fibre: 0, sugar: 0, mufa: 0, pufa: 0, epa: 0, dha: 0, ala: 0, unknownGrams: 0 } },
  ).filter((i) => i.level === "fail");
}

export function isOmega3Portion(lines: RuleLine[], personId: string): boolean {
  return linesFor(lines, personId).some((l) => l.isOmega3 && l.grams >= 80);
}

// Red meat. Recipes carry no reliable meat-type tag (Recipe.protein is free text, empty on ~70
// seed recipes; Ingredient only has isMeat), so it is derived from the ingredients with this explicit list:
// beef / veal / pork / lamb / mutton / goat / venison, incl. cured pork (bacon, pancetta, guanciale, ham,
// prosciutto, chorizo, salami) and mince that is not poultry. Only lines flagged isMeat
// count (so "beef tomato" never does); stock, broth, gelatin, lard and fat are not a meat portion.
const RED_MEAT = /\b(beef|veal|steaks?|ribeye|sirloin|pork|bacon|pancetta|guanciale|ham|prosciutto|chorizo|salami|lamb|mutton|goat|venison|minced?)\b/i;
const POULTRY = /\b(chicken|turkey|duck|poultry)\b/i;
const NOT_A_PORTION = /\b(stock|broth|bouillon|gelatine?|lard|fat|dripping)\b/i;
/** Grams of red meat in one portion before it counts as a red-meat meal (a 30 g pancetta garnish does not). */
export const RED_MEAT_MIN_GRAMS = 50;

export function isRedMeatLine(l: { slug: string; nameEn: string; isMeat: boolean }): boolean {
  if (!l.isMeat) return false;
  const n = `${l.slug.replace(/-/g, " ")} ${l.nameEn}`;
  return !POULTRY.test(n) && !NOT_A_PORTION.test(n) && RED_MEAT.test(n);
}

/** Red-meat grams in one person's portion: the shared base split by servings + their own lines. */
export function redMeatGrams(lines: RuleLine[], personId: string, servings: number): number {
  return linesFor(lines, personId)
    .filter(isRedMeatLine)
    .reduce((a, l) => a + (l.forUserId == null ? l.grams / Math.max(1, servings) : l.grams), 0);
}

export function isRedMeatPortion(lines: RuleLine[], personId: string, servings: number): boolean {
  return redMeatGrams(lines, personId, servings) >= RED_MEAT_MIN_GRAMS;
}

export function checkWeekRedMeat(p: RuleProfile, redMeals: number): Issue[] {
  if (p.redMeatMaxPerWeek == null || redMeals <= p.redMeatMaxPerWeek) return [];
  return [{ level: "fail", code: "redmeat", who: p.slug, msg: `${p.name}: ${redMeals} red-meat meals this week, max ${p.redMeatMaxPerWeek}` }];
}

// Optional household tuna cap (mercury), set with TUNA_MAX_PER_WEEK; unset or empty = no cap.
// A meal counts once when anyone's portion has tuna in it.
export function tunaMaxPerWeek(raw: string | undefined = process.env.TUNA_MAX_PER_WEEK): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
const TUNA = /\btuna\b/i;

export function isTunaLine(l: { slug: string; nameEn: string }): boolean {
  return TUNA.test(`${l.slug.replace(/-/g, " ")} ${l.nameEn}`);
}

export function isTunaMeal(lines: RuleLine[]): boolean {
  return lines.some((l) => l.grams > 0 && isTunaLine(l));
}

export function checkWeekTuna(tunaMeals: number, max: number | null = tunaMaxPerWeek()): Issue[] {
  if (max == null || tunaMeals <= max) return [];
  return [{ level: "fail", code: "tuna", who: "household", msg: `${tunaMeals} tuna meals this week, max ${max}` }];
}

export function checkWeekOmega3(p: RuleProfile, omega3Meals: number): Issue[] {
  const out: Issue[] = [];
  if (p.omega3MinPerWeek != null && omega3Meals < p.omega3MinPerWeek)
    out.push({ level: "fail", code: "omega3", who: p.slug, msg: `${p.name}: ${omega3Meals} oily-fish meals this week, needs ${p.omega3MinPerWeek}–${p.omega3MaxPerWeek ?? "?"}` });
  if (p.omega3MaxPerWeek != null && omega3Meals > p.omega3MaxPerWeek)
    out.push({ level: "fail", code: "omega3", who: p.slug, msg: `${p.name}: ${omega3Meals} oily-fish meals this week, max ${p.omega3MaxPerWeek}` });
  return out;
}

export const hasFail = (issues: Issue[]) => issues.some((i) => i.level === "fail");
