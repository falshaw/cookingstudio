// "New this week": the worker generates N recipes a week (default 3) on the local Ollama model, picked
// from gaps (Sauce School, liked cuisines, meal prep, seasonal produce, stock about to
// expire). Full pipeline: JSON → zod → household rules (reject + regenerate) → USDA macros →
// per-person rule check → ComfyUI images. Lands as status "draft" until someone in the household approves it.
import { prisma } from "./prisma";
import { generateValidated, ollamaUp } from "./ollama";
import { RecipeDraft } from "./llm-schema";
import { saveRecipe, ingredientKey } from "./recipe-save";
import { slugify, weekStart } from "./utils";
import { compLines, loadProfiles, nutritionMap, recipeMacros, ruleLines, toRuleProfile } from "./recipe-data";
import { checkPortion, type RuleProfile } from "./rules";
import { inRegion } from "./region";
import { tasteFor } from "./taste";
import { sauceIssues, sauceRuleText } from "./sauce-rule";


/** Produce in season by month (a generic northern-hemisphere temperate calendar — adjust it to your region). */
export const SEASON_PRODUCE: Record<number, string[]> = {
  1: ["cauliflower", "cabbage", "leeks", "parsnips", "oranges", "lemons"],
  2: ["cauliflower", "cabbage", "leeks", "kale", "swede", "oranges"],
  3: ["leeks", "spinach", "spring greens", "rhubarb", "radishes"],
  4: ["asparagus", "spinach", "spring onions", "radishes", "rhubarb"],
  5: ["asparagus", "new potatoes", "peas", "broad beans", "strawberries"],
  6: ["courgettes", "peas", "green beans", "new potatoes", "strawberries", "cherries"],
  7: ["tomatoes", "courgettes", "green beans", "cucumbers", "raspberries", "apricots"],
  8: ["tomatoes", "sweetcorn", "aubergines", "peppers", "plums", "peaches"],
  9: ["tomatoes", "peppers", "sweetcorn", "apples", "pears", "blackberries"],
  10: ["pumpkin", "squash", "apples", "pears", "mushrooms", "beetroot"],
  11: ["squash", "cauliflower", "broccoli", "brussels sprouts", "parsnips", "apples"],
  12: ["cabbage", "brussels sprouts", "leeks", "parsnips", "celeriac", "oranges"],
};

export const SAUCE_FAMILIES = ["quick", "mother", "pan", "emulsion", "tomato", "blender", "bbq", "mediterranean", "curry"] as const;

/**
 * Published Sauce School lessons (the recipes a dish's `sauceLesson` may point to), minus any lesson one of
 * `skipDislikedBy` (user ids) 👎'd — so a new recipe never links a lesson its cooks disliked.
 */
export async function loadSauceLessons(skipDislikedBy: string[] = []): Promise<{ slug: string; title: string }[]> {
  return prisma.recipe.findMany({
    where: { sauceFamily: { not: null }, status: "published", ...(skipDislikedBy.length ? { dislikes: { none: { userId: { in: skipDislikedBy } } } } : {}) },
    select: { slug: true, title: true },
    orderBy: { slug: "asc" },
  });
}

export async function getSetting<T>(key: string, def: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return (row?.value as T) ?? def;
}
export async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
}

/** Called from the idle worker: queue one feed job when the interval (7 days / perWeek) has passed. */
export async function maybeScheduleFeed(): Promise<void> {
  const perWeek = await getSetting<number>("feed.perWeek", 3);
  if (!perWeek || perWeek <= 0) return;
  const last = await getSetting<string | null>("feed.lastRun", null);
  const intervalMs = (7 / perWeek) * 86_400_000;
  if (last && Date.now() - new Date(last).getTime() < intervalMs) return;
  if (await prisma.job.findFirst({ where: { type: "feed", status: { in: ["queued", "running"] } } })) return;
  if (!(await ollamaUp())) return; // skip quietly, try again next idle tick
  const alex = await prisma.user.findUnique({ where: { slug: "alex" } });
  if (!alex) return;
  await setSetting("feed.lastRun", new Date().toISOString());
  await prisma.job.create({ data: { userId: alex.id, type: "feed", input: { auto: true } } });
}

export interface Gap {
  kind: "prep" | "sauce" | "cuisine" | "season" | "expiry";
  brief: string;
  recipeKind: "lesson" | "plan" | "prep";
  sauceFamily?: string;
}

/** Pick the next gap. The first feed recipe of each week is always a meal-prep batch. */
export async function pickGap(): Promise<Gap> {
  const ws = weekStart(new Date());
  const thisWeek = await prisma.recipe.count({ where: { source: "feed", createdAt: { gte: ws } } });
  const prepThisWeek = await prisma.recipe.count({ where: { source: "feed", kind: "prep", createdAt: { gte: ws } } });
  const kit = (await prisma.equipment.findMany({ where: { have: true } })).map((e) => e.slug);
  const gadget = kit.includes("slow-cooker") && thisWeek % 2 === 0 ? "slow cooker" : kit.includes("air-fryer") ? "air fryer" : "oven tray";
  if (prepThisWeek === 0) {
    return { kind: "prep", recipeKind: "prep", brief: `a MEAL-PREP batch (6 portions, cooked once on Sunday) using the ${gadget}` };
  }
  const soon = new Date(Date.now() + 3 * 86_400_000);
  const expiring = await prisma.stockItem.findMany({ where: { status: { not: "out" }, bestBefore: { lte: soon } }, include: { ingredient: true }, take: 4 });
  const cycle = thisWeek % 4;
  if (expiring.length && cycle !== 1) {
    return { kind: "expiry", recipeKind: "plan", brief: `a quick weeknight meal that uses up: ${expiring.map((e) => e.ingredient.nameEn).join(", ")}` };
  }
  if (cycle === 1) {
    const counts = await Promise.all(SAUCE_FAMILIES.map(async (f) => [f, await prisma.recipe.count({ where: { sauceFamily: f, status: "published" } })] as const));
    const [family] = [...counts].sort((a, b) => a[1] - b[1])[0];
    return { kind: "sauce", recipeKind: "lesson", sauceFamily: family, brief: `the next Sauce School lesson in the "${family}" family (a classic sauce not yet in the library)` };
  }
  if (cycle === 2) {
    const produce = SEASON_PRODUCE[new Date().getMonth() + 1] ?? [];
    return { kind: "season", recipeKind: "plan", brief: `a weeknight meal built on produce in season now: ${produce.join(", ")}` };
  }
  const users = await prisma.user.findMany({ include: { profile: true } });
  const liked = [...new Set(users.flatMap((u) => u.profile?.likedFoods ?? []))];
  const pick = liked.length ? liked[thisWeek % liked.length] : "Italian";
  return { kind: "cuisine", recipeKind: "plan", brief: `a weeknight meal in this style they love: ${pick}` };
}

/** How to split a shared recipe into the common base and per-person lines — built from the profiles, so every
 *  household rule in the prompt comes from someone's settings (vegetarian flag, net-carb cap). */
export function splitRules(kind: Gap["recipeKind"], people: Pick<RuleProfile, "slug" | "name" | "vegetarian" | "maxNetCarbsPerMeal">[]): string {
  if (kind === "lesson") return 'All ingredient components "both". servings 4 for a sauce, else 2.';
  const names = (ps: typeof people) => ps.map((p) => p.name).join(" and ");
  const veg = people.filter((p) => p.vegetarian);
  const eaters = people.filter((p) => !p.vegetarian);
  const base = veg.length && eaters.length
    ? `The shared base is VEGETARIAN (${names(veg)} ${veg.length > 1 ? "are" : "is"} vegetarian): base ingredients component "both". ${eaters.map((p) => `${p.name} eats meat or fish: add that protein (150-200 g raw per portion) with component "${p.slug}", cooked separately, quantities for ONE portion.`).join(" ")}`
    : veg.length
      ? "Everyone is vegetarian: no meat or fish anywhere (component \"both\")."
      : `Everyone eats meat and fish: the shared base (component "both") may include the main protein (150-200 g raw per portion).`;
  // Person lines are always ONE portion — a model left alone puts whole-pot amounts on them.
  const slugs = people.map((p) => `"${p.slug}"`).join(" or ");
  const qty = `Quantities: "both" lines are for the whole recipe (all servings); every ${slugs} line is the amount for ONE portion of that person, never the whole pot (e.g. rice ~75 g dry per portion, not 450 g).`;
  const carbs = people
    .filter((p) => p.maxNetCarbsPerMeal != null)
    .map((p) => {
      const other = people.find((o) => o.slug !== p.slug && o.maxNetCarbsPerMeal == null);
      const target = Math.max(0, (p.maxNetCarbsPerMeal ?? 0) - 5);
      return `${p.name} max ${p.maxNetCarbsPerMeal} g net carbs per meal${other ? `: any rice/bread/pasta/potato is component "${other.slug}" and ${p.name} gets a vegetable swap with component "${p.slug}"` : ": keep rice/bread/pasta/potato small"}. Aim for UNDER ${target} g net carbs in ${p.name}'s portion (the share of the "both" base plus the "${p.slug}" lines): starchy vegetables count too (sweet potato, parsnip, squash, sweetcorn, peas, carrots in quantity) and so do beans, lentils and chickpeas.`;
    })
    .join(" ");
  return `${base} ${qty}${carbs ? ` ${carbs}` : ""} servings ${kind === "prep" ? 6 : 2}. Max 30 minutes active cooking.${kind === "prep" ? " Give fridgeDays, freezerDays and reheat." : ""}`;
}

export async function runFeedJob(log: (m: string) => Promise<void>): Promise<{ slug: string; gap: string }> {
  const gap = await pickGap();
  await log(`gap: ${gap.kind} — ${gap.brief}`);
  const users = await loadProfiles();
  const people = users.map(toRuleProfile);
  const avoid = [...new Set(people.flatMap((p) => p.avoidFoods))];
  const ruleParts = [`never use ${avoid.join(", ") || "nothing listed"}`];
  if (people.some((p) => p.noAlcohol)) ruleParts.push("no alcohol");
  if (people.some((p) => p.noAddedSugar)) ruleParts.push("no added sugar or honey");
  const tastes = await Promise.all(users.map(async (u) => ({ name: u.name, t: await tasteFor(u.id) })));
  const tasteText = tastes
    .map(({ name, t }) => `${name} likes: ${[...t.overrides.likes, ...t.cuisines.map(([k]) => k), ...t.flavours.map(([k]) => k)].slice(0, 8).join(", ") || "not known yet"}; dislikes: ${[...t.overrides.dislikes, ...t.dislikes].join(", ") || "none known"}`)
    .join("\n");
  const existing = await prisma.recipe.findMany({ select: { title: true, slug: true } });
  const rejectedReasons = (await prisma.recipe.findMany({ where: { status: "rejected", rejectReason: { not: null } }, select: { title: true, rejectReason: true }, take: 15, orderBy: { createdAt: "desc" } }))
    .map((r) => `${r.title}: ${r.rejectReason}`)
    .join("; ");
  const dislikedText = (await prisma.dislike.findMany({ where: { recipeId: { not: null } }, select: { reason: true, recipe: { select: { title: true } }, user: { select: { name: true } } }, take: 20, orderBy: { createdAt: "desc" } }))
    .map((d) => `${d.user.name} disliked ${d.recipe?.title}${d.reason ? ` (${d.reason})` : ""}`)
    .join("; ");
  const existingKeys = new Set(existing.map((e) => ingredientKey(e.title)));
  // the gap "sauce" makes a Sauce School lesson itself — it needs the sauce step but links to no other lesson
  const isLesson = gap.kind === "sauce";
  const lessons = await loadSauceLessons(users.map((u) => u.id)); // a shared recipe: skip lessons either cook disliked
  const lessonSlugs = lessons.map((l) => l.slug);

  let feedback = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const draft = await generateValidated({
      prompt: `Create ONE new recipe: ${gap.brief}.
${splitRules(gap.recipeKind, people)}
Every ingredient: grams, home measure (qty + unit), prep, component. Steps 4-10 with why, cue (what it looks/sounds/smells like + time), mistake, who (sam = beginner-safe tasks, alex = knives/hot fat/searing/sauces, else either), minutes, timerSeconds, technique, imagePrompt (photo-realistic close-up of the step, no faces, no text). troubleshoot, goesWith, equipment, cuisine, protein (main protein in one word), flavourTags (3-5 words), spiceLevel 0-3.
${sauceRuleText(lessons, isLesson)}
Household rules: ${ruleParts.join("; ")}.
Tastes (from their history):
${tasteText}
Do NOT repeat any of these existing recipes: ${existing.map((e) => e.title).join("; ")}.
${rejectedReasons ? `Recently rejected (avoid the same problems): ${rejectedReasons}` : ""}${dislikedText ? `
Disliked dishes (avoid similar): ${dislikedText}` : ""}${feedback ? `\nYour previous recipe was REJECTED: ${feedback}` : ""}`,
      system: `You write correct, safe recipes for two beginner home cooks${inRegion()}. Answer only with the JSON object.`,
      schema: RecipeDraft,
      attempts: 2,
      onLog: log,
      check: (d) => (existingKeys.has(ingredientKey(d.title)) ? `"${d.title}" already exists — make a different dish` : sauceIssues(d, { lessonSlugs, isLesson })),
    });
    const slug = `${slugify(draft.title)}-${Date.now().toString(36).slice(-4)}`;
    const mealTypes = gap.recipeKind === "lesson" ? ["dinner"] : ["lunch", "dinner"];
    const saved = await saveRecipe(prisma, draft, { slug, level: gap.recipeKind === "lesson" ? 4 : 5, kind: gap.recipeKind, mealTypes, source: "feed", sauceFamily: gap.sauceFamily ?? null, sauceLesson: isLesson ? null : draft.sauceLesson.trim() || null, status: "draft" });
    const { fillPendingCards } = await import("./worker");
    await fillPendingCards(log);
    const fails = await checkSavedRecipe(saved.id, gap.recipeKind);
    if (!fails.length) {
      await log(`draft "${draft.title}" passes the rules — waiting for approval`);
      return { slug, gap: gap.kind };
    }
    feedback = fails.join("; ");
    await log(`rule check failed, regenerating: ${feedback}`);
    await prisma.recipe.delete({ where: { id: saved.id } });
  }
  throw new Error(`no recipe passed the rules after 3 tries: ${feedback}`);
}

/** Per-person rule check on the SAVED recipe (real USDA macros). Lessons: hard ingredient rules only. */
export async function checkSavedRecipe(recipeId: string, kind: string): Promise<string[]> {
  const r = await prisma.recipe.findUnique({ where: { id: recipeId }, include: { ingredients: { include: { ingredient: true } } } });
  if (!r) return ["missing"];
  const users = await loadProfiles();
  const nut = await nutritionMap(r.ingredients.map((i) => i.ingredient.fdcId));
  const pf = {
    alex: users.find((u) => u.slug === "alex")?.profile?.portionFactor ?? 1,
    sam: users.find((u) => u.slug === "sam")?.profile?.portionFactor ?? 1,
  };
  const m = recipeMacros(r.servings, compLines(r.ingredients, nut), pf);
  const out: string[] = [];
  for (const u of users) {
    const p = toRuleProfile(u);
    const issues = checkPortion(kind === "lesson" ? { ...p, vegetarian: false, maxNetCarbsPerMeal: null, minProteinPerMeal: null, maxCookMinutes: null, maxLunchMinutes: null } : p, {
      title: r.title,
      meal: "dinner",
      totalMinutes: r.prepMinutes + r.cookMinutes,
      precooked: kind !== "plan",
      lines: ruleLines(r.ingredients),
      context: { title: r.title, cuisine: r.cuisine, tags: r.flavourTags, sauceFamily: r.sauceFamily },
      macros: u.slug === "alex" ? m.alex : u.slug === "sam" ? m.sam : m.generic,
    });
    out.push(...issues.filter((i) => i.level === "fail").map((i) => i.msg));
    // Tell the next attempt WHICH ingredients carry the carbs — "37.6 g > 30 g" alone leaves the model guessing.
    if (issues.some((i) => i.level === "fail" && i.code === "netcarbs")) {
      const factor = u.slug === "alex" ? pf.alex : u.slug === "sam" ? pf.sam : 1;
      const top = carbSources(r.ingredients, nut, r.servings, u.slug, factor).slice(0, 3);
      if (top.length)
        out.push(`${u.name}'s biggest net-carb sources per portion: ${top.map((t) => `${t.name} ${t.grams} g = ${t.netCarbs} g`).join(", ")}. Cut these or move them to the other person's component; target under ${Math.max(0, (toRuleProfile(u).maxNetCarbsPerMeal ?? 30) - 5)} g`);
    }
  }
  return out;
}

/** Net carbs each ingredient adds to one person's portion, biggest first (base share + own lines). */
export function carbSources(
  lines: { component: string; grams: number; ingredient: { nameEn: string; fdcId: number | null } }[],
  nut: Map<number, { carbs: number; fibre: number | null }>,
  servings: number,
  who: string,
  factor: number,
): { name: string; grams: number; netCarbs: number }[] {
  return lines
    .filter((l) => l.component === "both" || l.component === who)
    .map((l) => {
      const ref = l.ingredient.fdcId != null ? nut.get(l.ingredient.fdcId) : undefined;
      const grams = l.component === "both" ? (l.grams * factor) / Math.max(1, servings) : l.grams * factor;
      const net = ref ? (grams / 100) * Math.max(0, ref.carbs - (ref.fibre ?? 0)) : 0;
      return { name: l.ingredient.nameEn, grams: Math.round(grams), netCarbs: Math.round(net * 10) / 10 };
    })
    .filter((x) => x.netCarbs >= 1)
    .sort((a, b) => b.netCarbs - a.netCarbs);
}
