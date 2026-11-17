// Week planner. The local model proposes a week from the plan-eligible library; CODE checks every portion
// for both people (rules.ts) plus the weekly oily-fish count, rejects + regenerates on failure,
// and falls back to a deterministic solver that only uses passing recipes. The prompt carries
// rules and forbidden foods only — never lab values or other health data.
import { prisma } from "./prisma";
import { checkPortion, checkWeekOmega3, checkWeekRedMeat, checkWeekTuna, hasFail, isOmega3Portion, isRedMeatPortion, isTunaMeal, tunaMaxPerWeek, type Issue, type RecipeContext, type RuleLine, type RuleProfile } from "./rules";
import { compLines, loadProfiles, nutritionMap, recipeMacros, ruleLines, toRuleProfile, type PersonMacros } from "./recipe-data";
import { generateValidated } from "./ollama";
import { PlanDraft } from "./llm-schema";
import { mealScore } from "./meal-score";
import { portionGl } from "./health-stats";
import { FREEZER_SAUCE_WHERE } from "./sauce-ladder";

export const MEALS = ["breakfast", "lunch", "dinner"] as const;
export type Meal = (typeof MEALS)[number];
export const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface Candidate {
  id: string;
  slug: string;
  title: string;
  kind: string;
  mealTypes: string[];
  totalMinutes: number;
  servings: number;
  lines: RuleLine[];
  macros: PersonMacros;
  scores: { alex: number; sam: number };
  context: RecipeContext;
}

export interface SlotChoice {
  day: number;
  meal: Meal;
  slug: string;
  locked?: boolean;
  precooked?: boolean;
  /** a frozen sauce portion (PrepBatch on /prep) covers this dinner — only the fresh side is cooked */
  freezerBatchId?: string;
  /** weekday lunch = last night's dinner (cook double) — 0 min at lunch */
  leftover?: boolean;
}

/** Plan + prep recipes, plus freezer sauces (kind "lesson") so frozen-portion slots can be evaluated. Sauces are
 *  never picked as fresh meals — solveWeek, the LLM list and swaps use `plannable()`. */
export async function loadCandidates(pf: { alex: number; sam: number }): Promise<Candidate[]> {
  const recipes = await prisma.recipe.findMany({
    // freezer sauces = real sauces only (sauceFamily set), never rice, roasts or stocks
    where: { status: "published", OR: [{ kind: { in: ["plan", "prep"] } }, { ...FREEZER_SAUCE_WHERE }] },
    include: { ingredients: { include: { ingredient: true } } },
  });
  const nut = await nutritionMap(recipes.flatMap((r) => r.ingredients.map((i) => i.ingredient.fdcId)));
  return recipes.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    mealTypes: r.mealTypes,
    totalMinutes: r.prepMinutes + r.cookMinutes,
    servings: r.servings,
    lines: ruleLines(r.ingredients),
    macros: recipeMacros(r.servings, compLines(r.ingredients, nut), pf),
    context: { title: r.title, cuisine: r.cuisine, tags: r.flavourTags, sauceFamily: r.sauceFamily },
    scores: (() => {
      const m = recipeMacros(r.servings, compLines(r.ingredients, nut), pf);
      const gl = r.ingredients.map((i) => ({ component: i.component, grams: i.grams, slug: i.ingredient.slug, ref: i.ingredient.fdcId != null ? nut.get(i.ingredient.fdcId) ?? null : null }));
      return { alex: mealScore(m.alex, portionGl(gl, r.servings, "alex", pf.alex).gl).score, sam: mealScore(m.sam, portionGl(gl, r.servings, "sam", pf.sam).gl).score };
    })(),
  }));
}

export const plannable = (cands: Candidate[]) => cands.filter((c) => c.kind === "plan" || c.kind === "prep");

/** Red-meat meals per person in a set of choices (each eaten slot counts, prep repeats too). */
export function redMeatCounts(choices: { slug: string }[], cands: Map<string, Candidate> | Candidate[], people: RuleProfile[]): Record<string, number> {
  const get = (slug: string) => (cands instanceof Map ? cands.get(slug) : cands.find((c) => c.slug === slug));
  const out: Record<string, number> = {};
  for (const p of people) out[p.slug] = choices.filter((s) => { const c = get(s.slug); return !!c && isRedMeatPortion(c.lines, p.slug, c.servings); }).length;
  return out;
}

/** True when adding `c` once more keeps everyone at or under their red-meat limit (`counts` = before adding). */
export function redMeatFits(c: Candidate, people: RuleProfile[], counts: Record<string, number>): boolean {
  return people.every((p) => p.redMeatMaxPerWeek == null || !isRedMeatPortion(c.lines, p.slug, c.servings) || (counts[p.slug] ?? 0) < p.redMeatMaxPerWeek);
}

/** Tuna meals in a set of choices (household count, each eaten slot counts). */
export function tunaCount(choices: { slug: string }[], cands: Map<string, Candidate> | Candidate[]): number {
  const get = (slug: string) => (cands instanceof Map ? cands.get(slug) : cands.find((c) => c.slug === slug));
  return choices.filter((s) => { const c = get(s.slug); return !!c && isTunaMeal(c.lines); }).length;
}

/** True when adding `c` once more keeps the week at or under the tuna cap (`count` = before adding). */
export function tunaFits(c: Candidate, count: number, max: number | null = tunaMaxPerWeek()): boolean {
  return max == null || !isTunaMeal(c.lines) || count < max;
}

export interface FreezerBatch { id: string; slug: string; left: number }

/** Frozen sauce portions take over dinners (2 portions = dinner for two), Mon→Sun, never a locked, prepped or
 *  oily-fish slot, never the same sauce two days running, and only where the sauce passes both people's rules. */
export function fillFromFreezer(choices: SlotChoice[], cands: Map<string, Candidate>, people: RuleProfile[], batches: FreezerBatch[]): SlotChoice[] {
  const out = choices.map((s) => ({ ...s }));
  const fish = (slug: string) => { const c = cands.get(slug); return !!c && people.some((p) => isOmega3Portion(c.lines, p.slug)); };
  for (const b of batches) {
    const sauce = cands.get(b.slug);
    if (!sauce || sauce.kind !== "lesson" || !sauce.context.sauceFamily || hasFail(slotIssues(sauce, "dinner", people, true, true))) continue;
    let left = b.left;
    for (let d = 0; d < 7 && left >= 2; d++) {
      const s = out.find((x) => x.day === d && x.meal === "dinner");
      if (!s || s.locked || s.precooked || s.freezerBatchId || fish(s.slug)) continue;
      if (out.some((x) => x.meal === "dinner" && Math.abs(x.day - d) === 1 && x.slug === b.slug)) continue;
      // a red-meat sauce (bolognese) never pushes anyone over their weekly red-meat limit
      if (!redMeatFits(sauce, people, redMeatCounts(out.filter((x) => x !== s), cands, people))) continue;
      Object.assign(s, { slug: b.slug, precooked: true, freezerBatchId: b.id });
      left -= 2;
    }
  }
  return out;
}

/** Tue–Fri lunch = the previous night's dinner (no cooking at lunch on a working day). Skips locked,
 *  prepped and freezer slots, and any swap that would break a weekly rule (red meat, tuna, oily fish). */
export function fillLeftoverLunches(choices: SlotChoice[], cands: Map<string, Candidate>, people: RuleProfile[]): SlotChoice[] {
  let out = choices.map((s) => ({ ...s }));
  for (let d = 1; d <= 4; d++) {
    const lunch = out.find((x) => x.day === d && x.meal === "lunch");
    const dinner = out.find((x) => x.day === d - 1 && x.meal === "dinner");
    if (!lunch || !dinner || lunch.locked || lunch.precooked || lunch.freezerBatchId || dinner.freezerBatchId || !cands.has(dinner.slug)) continue;
    const trial = out.map((x) => (x === lunch ? { ...x, slug: dinner.slug, leftover: true } : x));
    const before = evaluateWeek(out, cands, people).week.filter((i) => i.level === "fail").length;
    if (evaluateWeek(trial, cands, people).week.filter((i) => i.level === "fail").length > before) continue;
    out = trial;
  }
  return out;
}

/** Cooked sauce batches in the freezer with at least one dinner for two left. */
export async function loadFreezerBatches(): Promise<FreezerBatch[]> {
  const rows = await prisma.prepBatch.findMany({ where: { cookedAt: { not: null }, location: "freezer", recipe: { ...FREEZER_SAUCE_WHERE } }, include: { recipe: { select: { slug: true } } }, orderBy: { cookedAt: "asc" } });
  return rows.map((b) => ({ id: b.id, slug: b.recipe.slug, left: b.portions - b.eaten })).filter((b) => b.left >= 2);
}

/** Macro / time checks that a frozen sauce alone cannot meet — protein and carbs come from the fresh side cooked that night. */
const SAUCE_ONLY_SKIP = new Set(["protein", "netcarbs", "starch", "nutrition", "time"]);

export function slotIssues(c: Candidate, meal: Meal, people: RuleProfile[], precooked: boolean, frozenSauce = false): Issue[] {
  if (frozenSauce) return slotIssues(c, meal, people, true).filter((i) => !SAUCE_ONLY_SKIP.has(i.code));
  const out: Issue[] = [];
  if (!c.mealTypes.includes(meal)) out.push({ level: "fail", code: "meal", who: "both", msg: `${c.title} is not a ${meal} recipe` });
  for (const p of people) if (p.dislikedRecipeIds?.includes(c.id)) out.push({ level: "fail", code: "disliked", who: p.slug, msg: `${p.name} disliked ${c.title}` });
  for (const p of people) {
    const macros = p.slug === "alex" ? c.macros.alex : p.slug === "sam" ? c.macros.sam : c.macros.generic;
    out.push(...checkPortion(p, { title: c.title, meal, totalMinutes: c.totalMinutes, precooked: precooked || c.kind === "prep", lines: c.lines, macros, context: c.context }));
  }
  return out;
}

export interface WeekReport {
  ok: boolean;
  slots: { day: number; meal: Meal; slug: string; issues: Issue[] }[];
  week: Issue[];
  omega3: Record<string, number>;
  redMeat?: Record<string, number>;
}

export function evaluateWeek(choices: SlotChoice[], cands: Map<string, Candidate>, people: RuleProfile[]): WeekReport {
  const slots = choices.map((s) => {
    const c = cands.get(s.slug);
    if (!c) return { day: s.day, meal: s.meal, slug: s.slug, issues: [{ level: "fail" as const, code: "unknown", who: "both", msg: `unknown recipe "${s.slug}"` }] };
    return { day: s.day, meal: s.meal, slug: s.slug, issues: slotIssues(c, s.leftover ? "dinner" : s.meal, people, !!s.precooked || !!s.leftover, !!s.freezerBatchId) };
  });
  const omega3: Record<string, number> = {};
  const week: Issue[] = [];
  for (const p of people) {
    const n = choices.filter((s) => {
      const c = cands.get(s.slug);
      return c && isOmega3Portion(c.lines, p.slug);
    }).length;
    omega3[p.slug] = n;
    week.push(...checkWeekOmega3(p, n));
  }
  const redMeat = redMeatCounts(choices, cands, people);
  for (const p of people) week.push(...checkWeekRedMeat(p, redMeat[p.slug] ?? 0));
  week.push(...checkWeekTuna(tunaCount(choices, cands)));
  const ok = !slots.some((s) => hasFail(s.issues)) && !hasFail(week);
  return { ok, slots, week, omega3, redMeat };
}

/** Deterministic fallback: fill every unlocked slot with a passing recipe, hitting the fish range. */
export function solveWeek(cands: Candidate[], people: RuleProfile[], locked: SlotChoice[], seed = 1, favs: Set<string> = new Set()): SlotChoice[] {
  cands = plannable(cands);
  let rnd = seed;
  const rand = () => ((rnd = (rnd * 16807) % 2147483647) / 2147483647);
  const passing = (meal: Meal) => cands.filter((c) => !hasFail(slotIssues(c, meal, people, false)));
  const result: SlotChoice[] = [...locked];
  const taken = (d: number, m: Meal) => result.some((s) => s.day === d && s.meal === m);
  const fishFor = (c: Candidate) => people.some((p) => isOmega3Portion(c.lines, p.slug));
  const omegaTarget = Math.max(0, ...people.map((p) => p.omega3MinPerWeek ?? 0));
  const omegaMax = Math.min(99, ...people.map((p) => p.omega3MaxPerWeek ?? 99));
  const count = () => result.filter((s) => { const c = cands.find((x) => x.slug === s.slug); return c && fishFor(c); }).length;
  const used = new Map<string, number>();
  for (const s of result) used.set(s.slug, (used.get(s.slug) ?? 0) + 1);
  const redOk = (c: Candidate) => redMeatFits(c, people, redMeatCounts(result, cands, people)) && tunaFits(c, tunaCount(result, cands));
  const pick = (list: Candidate[]) => {
    const sorted = [...list].sort((a, b) => (used.get(a.slug) ?? 0) - (used.get(b.slug) ?? 0) || Number(favs.has(b.id)) - Number(favs.has(a.id)) || rand() - 0.5);
    return sorted[0];
  };
  // 1) oily fish dinners on Tue / Thu / Sat until the minimum is met
  for (const d of [1, 3, 5, 0, 2, 4, 6]) {
    if (count() >= omegaTarget) break;
    for (const meal of ["dinner", "lunch"] as Meal[]) {
      if (taken(d, meal) || count() >= omegaTarget) continue;
      const fish = passing(meal).filter(fishFor).filter(redOk);
      if (!fish.length) continue;
      const c = pick(fish);
      result.push({ day: d, meal, slug: c.slug });
      used.set(c.slug, (used.get(c.slug) ?? 0) + 1);
    }
  }
  // 2) everything else, non-fish once the fish budget is used
  for (let d = 0; d < 7; d++) {
    for (const meal of MEALS) {
      if (taken(d, meal)) continue;
      let list = passing(meal).filter(redOk);
      if (count() >= omegaMax) list = list.filter((c) => !fishFor(c));
      else if (count() >= omegaTarget) list = list.filter((c) => !fishFor(c)).length ? list.filter((c) => !fishFor(c)) : list;
      const prev = result.find((s) => s.day === d - 1 && s.meal === meal)?.slug;
      const noRepeat = list.filter((c) => c.slug !== prev);
      if (noRepeat.length) list = noRepeat;
      if (!list.length) continue;
      const c = pick(list);
      result.push({ day: d, meal, slug: c.slug });
      used.set(c.slug, (used.get(c.slug) ?? 0) + 1);
      // A prep batch (6 portions = 3 meals for two) fills the same meal on the next two days.
      if (c.kind === "prep") {
        for (const nd of [d + 1, d + 2]) {
          if (nd > 6 || taken(nd, meal)) continue;
          if (fishFor(c) && count() >= omegaMax) break;
          if (!redOk(c)) break;
          result.push({ day: nd, meal, slug: c.slug, precooked: true });
          used.set(c.slug, (used.get(c.slug) ?? 0) + 1);
        }
      }
    }
  }
  return result.sort((a, b) => a.day - b.day || MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
}

function rulesText(people: RuleProfile[]): string {
  return people
    .map((p) => {
      const r: string[] = [];
      if (p.vegetarian) r.push(`vegetarian (no meat/fish in their portion${p.vegBreakfastAllowed.length ? `, except ${p.vegBreakfastAllowed.join(", ")} at breakfast` : ""})`);
      if (p.maxNetCarbsPerMeal != null) r.push(`max ${p.maxNetCarbsPerMeal} g net carbs per meal`);
      if (p.minProteinPerMeal != null) r.push(`at least ${p.minProteinPerMeal} g protein per meal`);
      if (p.noAddedSugar) r.push("no added sugar");
      if (p.noAlcohol) r.push("no alcohol");
      if (p.noRefinedStarch) r.push("avoid white rice/bread/pasta");
      if (p.omega3MinPerWeek != null) r.push(`oily fish ${p.omega3MinPerWeek}-${p.omega3MaxPerWeek ?? p.omega3MinPerWeek} times per week`);
      if (p.redMeatMaxPerWeek != null) r.push(`red meat (beef, veal, pork, lamb, bacon/ham) at most ${p.redMeatMaxPerWeek} times per week`);
      if (p.maxCookMinutes != null) r.push(`max ${p.maxCookMinutes} min cooking per fresh meal`);
      if (p.maxLunchMinutes != null) r.push(`lunch must be quick: max ${p.maxLunchMinutes} min, one step (or leftovers / meal prep)`);
      if (p.avoidFoods.length) r.push(`never: ${p.avoidFoods.join(", ")}`);
      return `- ${p.name}: ${r.length ? r.join("; ") : "no restrictions"}`;
    })
    .concat(tunaMaxPerWeek() != null ? [`- Household: tuna at most ${tunaMaxPerWeek()} meals per week`] : [])
    .join("\n");
}

export async function generatePlan(weekStart: Date, log: (m: string) => Promise<void>): Promise<{ planId: string; report: WeekReport; generatedBy: string }> {
  const users = await loadProfiles();
  const people = users.map(toRuleProfile);
  const pf = {
    alex: users.find((u) => u.slug === "alex")?.profile?.portionFactor ?? 1,
    sam: users.find((u) => u.slug === "sam")?.profile?.portionFactor ?? 1,
  };
  const cands = await loadCandidates(pf);
  const byslug = new Map(cands.map((c) => [c.slug, c]));
  const existing = await prisma.mealPlan.findUnique({ where: { weekStart }, include: { slots: { include: { recipe: true } } } });
  const locked: SlotChoice[] = (existing?.slots ?? []).filter((s) => s.locked).map((s) => ({ day: s.day, meal: s.meal as Meal, slug: s.recipe.slug, locked: true }));

  const favRows = await prisma.favourite.findMany({ select: { recipeId: true } });
  const favs = new Set(favRows.map((f) => f.recipeId));
  const eligible = plannable(cands).filter((c) => MEALS.some((m) => c.mealTypes.includes(m) && !hasFail(slotIssues(c, m, people, false))));
  const list = eligible
    .map((c) => `${c.slug} | ${c.title} | meals: ${c.mealTypes.join("/")} | oily fish: ${people.some((p) => isOmega3Portion(c.lines, p.slug)) ? "yes" : "no"} | ${c.kind === "prep" ? "meal-prep batch" : `${c.totalMinutes} min`}${favs.has(c.id) ? " | FAVOURITE" : ""}`)
    .join("\n");
  const lockedText = locked.length ? `Keep these fixed: ${locked.map((l) => `${DAYS[l.day]} ${l.meal}=${l.slug}`).join(", ")}.` : "";
  const prompt = `Plan 7 days (Monday first) of breakfast, lunch and dinner for a couple who eat together.
Use ONLY slugs from this list, each slot must use a recipe whose "meals" include that slot:
${list}

Household rules (the app checks them in code):
${rulesText(people)}

Prefer recipes marked FAVOURITE (use each 1-2 times). Variety: do not repeat a recipe on consecutive days for the same meal. Meal-prep batches may repeat on 2-3 days (cooked once on Sunday). ${lockedText}
Answer JSON: {"days":[{"breakfast":"slug","lunch":"slug","dinner":"slug"}, ... 7 items]}`;

  let choices: SlotChoice[] | null = null;
  let generatedBy = "llm";
  try {
    const draft = await generateValidated({
      prompt,
      system: "You are a meal planner. Answer only with the JSON object.",
      schema: PlanDraft,
      attempts: 3,
      onLog: log,
      check: (d) => {
        const ch = toChoices(d, locked);
        const rep = evaluateWeek(ch, byslug, people);
        if (rep.ok) return null;
        const errs = [...rep.slots.flatMap((s) => s.issues.filter((i) => i.level === "fail").map((i) => `${DAYS[s.day]} ${s.meal}: ${i.msg}`)), ...rep.week.filter((i) => i.level === "fail").map((i) => i.msg)];
        return errs.slice(0, 10).join("; ");
      },
    });
    choices = toChoices(draft, locked);
  } catch (e) {
    await log(`LLM plan rejected (${(e as Error).message.slice(0, 300)}) — using the rule solver`);
    generatedBy = "solver";
  }
  if (!choices) choices = solveWeek(cands, people, locked, weekStart.getTime() % 100000 || 7, favs);
  const frozen = await loadFreezerBatches();
  choices = fillLeftoverLunches(fillFromFreezer(choices, byslug, people, frozen), byslug, people);
  const fromFreezer = choices.filter((c) => c.freezerBatchId).length;
  if (fromFreezer) await log(`${fromFreezer} dinner${fromFreezer === 1 ? "" : "s"} from frozen sauce portions`);
  const report = evaluateWeek(choices, byslug, people);
  await log(report.ok ? "week passes every rule" : "week still has rule failures (see report)");
  const planId = await writePlan(weekStart, choices, byslug, generatedBy, report);
  return { planId, report, generatedBy };
}

function toChoices(d: PlanDraft, locked: SlotChoice[]): SlotChoice[] {
  const out: SlotChoice[] = [];
  d.days.forEach((day, i) => {
    for (const meal of MEALS) {
      const l = locked.find((x) => x.day === i && x.meal === meal);
      out.push(l ?? { day: i, meal, slug: day[meal].trim() });
    }
  });
  return out;
}

/** Persist the week: prep recipes become PrepBatches (cooked Sunday), their slots draw portions. */
export async function writePlan(weekStart: Date, choices: SlotChoice[], cands: Map<string, Candidate>, generatedBy: string, report: WeekReport): Promise<string> {
  return prisma.$transaction(async (tx) => {
    const plan = await tx.mealPlan.upsert({
      where: { weekStart },
      create: { weekStart, generatedBy, report: report as object },
      update: { generatedBy, report: report as object },
    });
    await tx.mealSlot.deleteMany({ where: { planId: plan.id } });
    await tx.prepBatch.deleteMany({ where: { planId: plan.id } });
    const batches = new Map<string, { id: string; left: number }>();
    for (const s of choices) {
      const c = cands.get(s.slug);
      if (!c) continue;
      let prepBatchId: string | null = null;
      let source = "fresh";
      if (s.leftover) {
        source = "leftover";
      } else if (s.freezerBatchId) {
        prepBatchId = s.freezerBatchId;
        source = "freezer";
      } else if (c.kind === "prep") {
        let b = batches.get(c.slug);
        if (!b || b.left < 2) {
          const row = await tx.prepBatch.create({ data: { planId: plan.id, recipeId: c.id, portions: c.servings, prepDay: 6 } });
          b = { id: row.id, left: c.servings };
          batches.set(c.slug, b);
        }
        b.left -= 2;
        prepBatchId = b.id;
        source = "prep";
      }
      await tx.mealSlot.create({ data: { planId: plan.id, day: s.day, meal: s.meal, recipeId: c.id, locked: !!s.locked, source, prepBatchId } });
    }
    return plan.id;
  });
}
