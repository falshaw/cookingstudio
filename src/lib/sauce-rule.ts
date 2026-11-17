// Sauce rule for AI recipes (checked in code).
// Every feed / teach recipe needs an explicit "make the sauce" step in fork-and-spoon actions with a done cue,
// and a `sauceLesson` = slug of an existing Sauce School lesson that teaches it — except a feed recipe that IS
// the next Sauce School lesson (it is the lesson). A failing draft is rejected and regenerated with these
// reasons, like the carb rule. Pure — tested in tests/sauce-rule.test.ts.

/** The prompt lines that ask for it (feed + teach). `lessons` = "slug (title)" list the model picks from. */
export function sauceRuleText(lessons: { slug: string; title: string }[], isLesson = false): string {
  if (isLesson) return `This recipe IS the sauce lesson: one step must be the "make the sauce" step itself (what to press, scrape, stir or whisk, and the done cue, e.g. "bubble 2 min until it coats the back of a spoon"). sauceLesson = "".`;
  return `SAUCE (required): one step must be an explicit "make the sauce" step in plain fork-and-spoon actions, using only this recipe's own ingredients plus water, salt and pepper: e.g. "press each tomato flat with a fork, scrape the brown bits from the pan, stir in the cream and bubble 2 minutes until it coats the back of a spoon". Never end the recipe with juices, burst tomatoes or melted cheese left in the dish — turn them into the sauce. The step text must contain the word "sauce", an action (scrape, stir, whisk, bubble, simmer, reduce, press, mash, deglaze, blend) and a done cue (until …, or a time in minutes). Do not explain basics (cutting, frying, doneness).
sauceLesson = the slug of the Sauce School lesson that teaches this sauce, exactly one of: ${lessons.map((l) => `${l.slug} (${l.title})`).join("; ")}.`;
}

const SAUCE_WORD = /\bsauce\b/i;
const ACTION = /\b(scrap(e|ing)|stir(s|ring)?|whisk(ing)?|bubbl(e|ing)|simmer(ing)?|reduc(e|ing)|press(ing)?|mash(ing)?|deglaz(e|ing)|blend(ing)?|emulsif(y|ies)|swirl(ing)?|thicken(s|ing)?)\b/i;
const CUE = /\buntil\b|\d+\s*(-|–|to)?\s*\d*\s*(min|minutes|sec|seconds)\b|coats?\b/i;

/** Index of the first step that really MAKES a sauce (sauce word + action + done cue in text or cue), or -1. */
export function sauceStepIndex(steps: { text: string; cue?: string }[]): number {
  return steps.findIndex((s) => SAUCE_WORD.test(s.text) && ACTION.test(s.text) && (CUE.test(s.text) || CUE.test(s.cue ?? "")));
}

/** Words in a recipe's steps that mean something is left in the pan / dish to turn into a sauce. */
export const SAUCE_TRIGGER = /\b(juices?|roast(ed|ing)?|tomato(es)?|cheese|cream|feta|halloumi|mozzarella|parmesan|pan)\b/i;

/** Everyday recipes that hit the trigger but have no sauce to make — reason shown by check:sauce. Keep short. */
export const NO_SAUCE: Record<string, string> = {
  "p-yogurt-bowl": "cold breakfast bowl (\"cream\" = texture of the whipped base)",
  "p-egg-muffins": "baked egg muffins, meal-prep breakfast",
  "p-feta-omelette": "omelette, the feta melts inside the fold",
  "feta-scrambled-eggs-peppers": "scrambled eggs",
  "tuna-scrambled-eggs": "scrambled eggs",
  "tomato-scrambled-eggs": "scrambled eggs",
  "omelette-roll-chicken": "rolled omelette with a cold filling",
  "chicken-quesadilla": "the melted cheese is sealed inside the bread",
  "b-soup": "blended soup — the soup is the sauce",
  "smoked-salmon-rocket-toast": "cold open toast, the cream cheese is a spread",
  "scrambled-eggs-pancetta-onion": "scrambled eggs",
  "chopped-egg-toast": "egg toast, the \"juice\" is lemon on the avocado",
};

/** True when an everyday recipe's steps leave juices / tomatoes / cheese / cream that must become a sauce. */
export function needsSauce(steps: { text: string }[]): boolean {
  return steps.some((s) => SAUCE_TRIGGER.test(s.text));
}

/**
 * check:sauce for one published recipe: null = fine. Lessons themselves are not checked; a plan/prep recipe
 * with a `sauceFamily` (Thai curries) is a lesson too and needs only the step.
 */
export function recipeSauceProblem(
  r: { slug: string; kind: string; sauceFamily: string | null; sauceLesson: string | null; steps: { text: string; cue?: string }[] },
  lessonSlugs: string[],
): string | null {
  if (r.kind === "lesson" || NO_SAUCE[r.slug] || !needsSauce(r.steps)) return null;
  return sauceIssues({ steps: r.steps, sauceLesson: r.sauceLesson ?? "" }, { lessonSlugs, isLesson: !!r.sauceFamily });
}

export interface LessonOption { slug: string; title: string; sauceFamily: string | null; level: number; ingredientIds: string[] }

/**
 * The lesson link a viewer sees for a dish: the linked lesson, unless the viewer disliked it — then
 * the closest liked lesson in the same sauceFamily (most ingredients shared with the DISH, then lower level, then
 * slug), or null. `options` = published lessons incl. the linked one; `disliked` = recipe slugs the viewer 👎'd.
 */
export function pickSauceLesson(wanted: string | null, options: LessonOption[], disliked: Set<string>, dishIngredientIds: string[]): LessonOption | null {
  if (!wanted) return null;
  const linked = options.find((o) => o.slug === wanted);
  if (!linked) return null;
  if (!disliked.has(linked.slug)) return linked;
  if (!linked.sauceFamily) return null;
  const dish = new Set(dishIngredientIds);
  const score = (o: LessonOption) => new Set(o.ingredientIds.filter((id) => dish.has(id))).size;
  const pool = options.filter((o) => o.slug !== linked.slug && o.sauceFamily === linked.sauceFamily && !disliked.has(o.slug));
  pool.sort((a, b) => score(b) - score(a) || a.level - b.level || a.slug.localeCompare(b.slug));
  return pool[0] ?? null;
}

/**
 * Reasons this draft breaks the sauce rule, or null. `lessonSlugs` = published Sauce School lessons; an empty
 * list (fresh DB without lessons) skips only the lesson-link part, never the step.
 */
export function sauceIssues(d: { steps: { text: string; cue?: string }[]; sauceLesson?: string }, opts: { lessonSlugs: string[]; isLesson?: boolean }): string | null {
  const out: string[] = [];
  if (sauceStepIndex(d.steps) < 0)
    out.push('no "make the sauce" step: add one step whose text says "sauce", what to do (scrape / stir / whisk / bubble / press …) and when it is done (until it coats the spoon, or N minutes), using only the recipe\'s own ingredients + water/salt/pepper');
  if (!opts.isLesson && opts.lessonSlugs.length) {
    const s = (d.sauceLesson ?? "").trim();
    if (!s) out.push(`sauceLesson is missing: pick the Sauce School lesson that teaches this sauce from: ${opts.lessonSlugs.join(", ")}`);
    else if (!opts.lessonSlugs.includes(s)) out.push(`sauceLesson "${s}" is not a Sauce School lesson — use exactly one of: ${opts.lessonSlugs.join(", ")}`);
  }
  return out.length ? out.join("; ") : null;
}
