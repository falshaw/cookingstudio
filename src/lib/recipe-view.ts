// Builds the serialisable view model for the recipe page, cook-along, mise en place and
// cook-together screens: lines, steps, macros per person, rule checks, stock check, practice.
import { prisma } from "./prisma";
import { pickSides, SIDE_SLUGS, type SidePick } from "./sides";
import { compLines, loadProfiles, loadRecipe, nutritionMap, recipeMacros, ruleLines, toRuleProfile, type PersonMacros } from "./recipe-data";
import { checkPortion, type Issue } from "./rules";
import { detectTimers, type DetectedTimer } from "./cooking";
import { mealScore, type MealScore } from "./meal-score";
import { portionGl } from "./health-stats";
import { suggestSwaps, type SwapSuggestion } from "./swaps";
import { sauceStepIndex } from "./sauce-rule";

export interface LineVM {
  id: string;
  component: string;
  qty: number;
  grams: number;
  unit: string;
  prep: string;
  ingredient: { slug: string; nameEn: string; image: { id: string; status: string } | null; protein: boolean };
}

export interface StepVM {
  n: number;
  text: string;
  why: string;
  cue: string;
  mistake: string;
  who: string;
  minutes: number;
  technique: string | null;
  techniqueTitle: string | null;
  image: { id: string; status: string } | null;
  lineIds: string[];
  timers: DetectedTimer[];
}

export interface RecipeVM {
  id: string;
  slug: string;
  title: string;
  description: string;
  level: number;
  kind: string;
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  equipment: string[];
  sauceFamily: string | null;
  sauceLesson: string | null;
  /** title of the published lesson `sauceLesson` points at, null = none / not published */
  sauceLessonTitle: string | null;
  /** index into `steps` of the "make the sauce" step (sauceStepIndex), -1 = none */
  sauceStep: number;
  troubleshoot: { problem: string; fix: string }[];
  goesWith: string;
  variantNote: string;
  fridgeDays: number | null;
  freezerDays: number | null;
  reheat: string | null;
  leftoverIdeas: string;
  hero: { id: string; status: string; video?: string | null } | null;
  lines: LineVM[];
  steps: StepVM[];
  macros: PersonMacros;
  issues: { alex: Issue[]; sam: Issue[] };
  missing: string[];
  practice: { userName: string; count: number; confidence: number | null }[];
  lastTweak: string;
  scores: { alex: MealScore & { gl: number | null }; sam: MealScore & { gl: number | null }; generic: MealScore & { gl: number | null } };
  swaps: (SwapSuggestion & { toName: string | null })[];
  /** healthy sides for the signed-in person (empty for pure sauce lessons and breakfasts) */
  sides: SidePick[];
  /** the signed-in person's net-carb limit per meal (null = none) */
  sidesLimit: number | null;
}

export async function recipeVM(slug: string, userId: string): Promise<RecipeVM | null> {
  const r = await loadRecipe(slug);
  if (!r) return null;
  const nut = await nutritionMap(r.ingredients.map((i) => i.ingredient.fdcId));
  const users = await loadProfiles();
  const pf = { alex: users.find((u) => u.slug === "alex")?.profile?.portionFactor ?? 1, sam: users.find((u) => u.slug === "sam")?.profile?.portionFactor ?? 1 };
  const macros = recipeMacros(r.servings, compLines(r.ingredients, nut), pf);
  const rl = ruleLines(r.ingredients);
  const glLines = r.ingredients.map((i) => ({ component: i.component, grams: i.grams, slug: i.ingredient.slug, ref: i.ingredient.fdcId != null ? nut.get(i.ingredient.fdcId) ?? null : null }));
  const scoreFor = (who: "alex" | "sam" | null) => {
    const gl = portionGl(glLines, r.servings, who, who === "alex" ? pf.alex : who === "sam" ? pf.sam : 1).gl;
    return { ...mealScore(who === "alex" ? macros.alex : who === "sam" ? macros.sam : macros.generic, gl), gl };
  };
  const scores = { alex: scoreFor("alex"), sam: scoreFor("sam"), generic: scoreFor(null) };
  const swapLines = r.ingredients.map((i, k) => ({ ...rl[k], id: i.id }));
  const rawSwaps = users.filter((u) => u.slug === "alex" || u.slug === "sam").flatMap((u) => suggestSwaps(toRuleProfile(u), swapLines, { title: r.title, cuisine: r.cuisine, tags: r.flavourTags, sauceFamily: r.sauceFamily }));
  const swapTargets = new Map((await prisma.ingredient.findMany({ where: { slug: { in: rawSwaps.map((s) => s.swap.to).filter((x): x is string => !!x) } }, select: { slug: true, nameEn: true } })).map((i) => [i.slug, i.nameEn]));
  const swaps = rawSwaps.map((s) => ({ ...s, toName: s.swap.to ? swapTargets.get(s.swap.to) ?? null : null }));
  const issues = { alex: [] as Issue[], sam: [] as Issue[] };
  for (const u of users) {
    if (u.slug !== "alex" && u.slug !== "sam") continue;
    const p = toRuleProfile(u);
    issues[u.slug] = checkPortion(p, {
      title: r.title,
      meal: r.mealTypes.includes("dinner") ? "dinner" : (r.mealTypes[0] ?? "dinner"),
      totalMinutes: r.prepMinutes + r.cookMinutes,
      precooked: r.kind !== "plan",
      lines: rl,
      context: { title: r.title, cuisine: r.cuisine, tags: r.flavourTags, sauceFamily: r.sauceFamily },
      macros: u.slug === "alex" ? macros.alex : macros.sam,
    });
  }
  const viewer = users.find((u) => u.id === userId);
  const viewerPortion = viewer?.slug === "sam" ? macros.sam : macros.alex;
  // a lesson gets sides only when it is a whole meal (meat stock alone does not make gravy a dinner)
  const mainMeal = r.mealTypes.some((m) => m === "lunch" || m === "dinner") && (r.kind !== "lesson" || viewerPortion.protein >= 15);
  let sides: SidePick[] = [];
  if (viewer && (viewer.slug === "alex" || viewer.slug === "sam") && mainMeal) {
    const sideIngs = await prisma.ingredient.findMany({ where: { slug: { in: SIDE_SLUGS } }, select: { slug: true, nameEn: true, fdcId: true } });
    const sideNut = await nutritionMap(sideIngs.map((i) => i.fdcId));
    sides = pickSides({
      recipeSlug: r.slug,
      cuisine: r.cuisine,
      ingredientSlugs: r.ingredients.map((i) => i.ingredient.slug),
      portion: viewerPortion,
      profile: toRuleProfile(viewer),
      refs: new Map(sideIngs.map((i) => [i.slug, { nameEn: i.nameEn, ref: i.fdcId != null ? sideNut.get(i.fdcId) ?? null : null }])),
    });
  }
  const ingIds = r.ingredients.map((i) => i.ingredientId);
  const [stock, techniques, imgs, cooks, lesson] = await Promise.all([
    prisma.stockItem.findMany({ where: { ingredientId: { in: ingIds } } }),
    prisma.technique.findMany({ select: { slug: true, title: true } }),
    prisma.image.findMany({ where: { id: { in: r.ingredients.map((i) => i.ingredient.imageId).filter((x): x is string => !!x) } }, select: { id: true, status: true } }),
    // a lesson also counts the times its sauce was made inside other dishes (CookLog.sauceLessonSlug)
    prisma.cookLog.findMany({ where: { OR: [{ recipeId: r.id }, { sauceLessonSlug: r.slug }] }, include: { user: { select: { name: true, id: true } } }, orderBy: { cookedAt: "asc" } }),
    r.sauceLesson ? prisma.recipe.findFirst({ where: { slug: r.sauceLesson, status: "published" }, select: { title: true } }) : null,
  ]);
  const have = new Set(stock.filter((s) => s.status !== "out").map((s) => s.ingredientId));
  const missing = [...new Set(r.ingredients.filter((i) => !have.has(i.ingredientId)).map((i) => i.ingredient.nameEn))];
  const tmap = new Map(techniques.map((t) => [t.slug, t.title]));
  const imap = new Map(imgs.map((i) => [i.id, i]));
  const byUser = new Map<string, { userName: string; count: number; confidence: number | null }>();
  let lastTweak = "";
  for (const c of cooks) {
    const cur = byUser.get(c.user.id) ?? { userName: c.user.name, count: 0, confidence: null };
    cur.count++;
    if (c.recipeId === r.id) cur.confidence = c.confidence;
    byUser.set(c.user.id, cur);
    if (c.recipeId === r.id && c.user.id === userId && c.tweak) lastTweak = c.tweak;
  }
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    
    description: r.description,
    level: r.level,
    kind: r.kind,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    equipment: r.equipment,
    sauceFamily: r.sauceFamily,
    sauceLesson: r.sauceLesson,
    sauceLessonTitle: lesson?.title ?? null,
    sauceStep: sauceStepIndex(r.steps),
    troubleshoot: Array.isArray(r.troubleshoot) ? (r.troubleshoot as { problem: string; fix: string }[]) : [],
    goesWith: r.goesWith,
    variantNote: r.variantNote,
    fridgeDays: r.fridgeDays,
    freezerDays: r.freezerDays,
    reheat: r.reheat,
    leftoverIdeas: r.leftoverIdeas,
    hero: r.hero,
    lines: r.ingredients.map((i) => ({
      id: i.id,
      component: i.component,
      qty: i.qty,
      grams: i.grams,
      unit: i.unit,
      prep: i.prep,
      ingredient: { slug: i.ingredient.slug, nameEn: i.ingredient.nameEn, image: i.ingredient.imageId ? imap.get(i.ingredient.imageId) ?? null : null, protein: i.ingredient.isMeat || i.ingredient.isFish },
    })),
    steps: r.steps.map((s) => {
      const timers = detectTimers(s.text);
      if (s.timerSeconds > 0 && !timers.some((t) => t.seconds === s.timerSeconds)) timers.unshift({ label: `Step ${s.n} timer`, seconds: s.timerSeconds });
      return {
        n: s.n,
        text: s.text,
        why: s.why,
        cue: s.cue,
        mistake: s.mistake,
        who: s.who,
        minutes: s.minutes,
        technique: s.technique,
        techniqueTitle: s.technique ? tmap.get(s.technique) ?? null : null,
        image: s.image,
        lineIds: s.ingredientIds,
        timers,
      };
    }),
    macros,
    issues,
    missing,
    practice: [...byUser.values()],
    lastTweak,
    scores,
    swaps,
    sides,
    sidesLimit: viewer?.profile?.maxNetCarbsPerMeal ?? null,
  };
}
