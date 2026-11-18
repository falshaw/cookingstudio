// In-process background worker, started once from src/instrumentation.ts. One loop, strictly
// sequential, because the text model and FLUX usually share one GPU: LLM jobs first, then images.
// Requests only ever enqueue rows; nothing slow runs inside a request.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "./prisma";
import { generateValidated, ollamaVisionJson, unloadTextModel, VISION_MODEL } from "./ollama";
import { IngredientCards, LabExtract, PhotoItems, RecipeDraft, parseModelJson } from "./llm-schema";
import { imageGenerationOn, renderToFile, releaseComfyMemory } from "./comfyui";
import { saveRecipe } from "./recipe-save";
import { checkIngredientsOnly } from "./rules";
import { inferFlags, mergeFlags } from "./flags";
import { loadProfiles, toRuleProfile } from "./recipe-data";
import { generatePlan } from "./planner";
import { findNutrition } from "./nutrition-search";
import { fetchRecipePage } from "./fetch-page";
import { slugify } from "./utils";
import { sauceIssues, sauceRuleText } from "./sauce-rule";
import { loadSauceLessons } from "./feed";
import { logError, logInfo, logWarn } from "./log";
import { inRegion } from "./region";

const run = promisify(execFile);

const RECIPE_SYSTEM = `You write recipes for beginner home cooks${inRegion()}. Plain words, correct technique, safe temperatures (°C, fan oven), realistic quantities in grams. Never invent facts. Answer only with the JSON object.`;

export function recipePrompt(dish: string, rules: string, sauce = ""): string {
  return `Recipe to teach: ${dish}.
Every ingredient: grams for the stated servings, a home measure (qty + unit: g, ml, tbsp, tsp, pc, clove), prep (what to do before cooking, "" if none), for "" (shared by everyone).
Steps 4-10, one action each.
why = the cooking science in 1-2 sentences. cue = what it looks/sounds/smells like when done, with a time. mistake = the most common beginner mistake and how to avoid it.
skill = "beginner" for beginner-safe tasks (washing, measuring, stirring, assembling), "skilled" for knives, hot fat, searing, sauces, else "either". minutes = step duration. timerSeconds = timed wait in seconds or 0.
technique = main technique or "none". imagePrompt = photo-realistic close-up of this exact step, hands allowed, no faces, no text.
troubleshoot = 2-4 problems with fixes. goesWith = what to serve it with. equipment = tools needed.${sauce ? `\n${sauce}` : ""}
Household rules: ${rules}`;
}

export async function householdRuleText(): Promise<string> {
  const people = (await loadProfiles()).map(toRuleProfile);
  const avoid = [...new Set(people.flatMap((p) => p.avoidFoods))];
  const parts = [];
  if (avoid.length) parts.push(`never use: ${avoid.join(", ")}`);
  if (people.some((p) => p.noAlcohol)) parts.push("no alcohol (use an alcohol-free swap such as stock + a little vinegar)");
  if (people.some((p) => p.noAddedSugar)) parts.push("no added sugar or honey");
  return parts.join("; ") || "none";
}

/** Reject a draft if any person's hard ingredient rules fail (alcohol, sugar, avoid list). */
export async function draftRuleCheck(d: RecipeDraft): Promise<string | null> {
  const people = (await loadProfiles()).map(toRuleProfile);
  const unknown = [...new Set(d.ingredients.map((i) => i.for).filter((s) => s && !people.some((p) => p.slug === s)))];
  if (unknown.length) return `"for" names nobody in this household: ${unknown.join(", ")} (use "" or one of ${people.map((p) => p.slug).join(", ")})`;
  const lines = d.ingredients.map((i) => ({ slug: slugify(i.name), nameEn: i.name, forUserId: i.for ? people.find((p) => p.slug === i.for)!.id : null, grams: i.grams, ...inferFlags(i.name) }));
  const fails = people.flatMap((p) => checkIngredientsOnly(p, d.title, lines, { title: d.title, cuisine: d.cuisine, tags: d.flavourTags }));
  return fails.length ? fails.map((f) => f.msg).join("; ") : null;
}

async function appendLog(jobId: string, msg: string) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg.slice(0, 2000)}\n`;
  // capped at the last 20 000 characters
  await prisma.$executeRaw`UPDATE "Job" SET log = right(log || ${line}, 20000), "updatedAt" = now() WHERE id = ${jobId}`;
}

/** Write guide cards for ingredients that only have a name (created by teach-me / import). */
export async function fillPendingCards(log: (m: string) => Promise<void>) {
  const pending = await prisma.ingredient.findMany({ where: { cardStatus: "pending" }, take: 12 });
  if (!pending.length) return;
  await log(`writing ${pending.length} ingredient guide card(s)`);
  const cards = await generateValidated({
    prompt: `Write an ingredient guide card for each of these, for total beginners shopping${inRegion()}: ${pending.map((p) => p.nameEn).join("; ")}.
whatItIs = what it is in plain words. buyTips = where/what to buy in an ordinary supermarket${inRegion()} (brand or shop names only if sure, else describe the aisle). substitutes, storage. section = supermarket section. usdaSearch = a short USDA FoodData Central search term (e.g. "onions raw"). Flags true only if certain. Keep nameEn exactly as given.`,
    system: "You write short, correct ingredient guides. Never invent brands you are unsure of. Answer only with JSON.",
    schema: IngredientCards,
    attempts: 2,
    onLog: log,
  });
  for (const p of pending) {
    const c = cards.cards.find((x) => x.nameEn.toLowerCase() === p.nameEn.toLowerCase());
    if (!c) continue;
    const nut = await findNutrition(c.usdaSearch || p.nameEn);
    const flags = mergeFlags({ isMeat: c.isMeat, isFish: c.isFish, isAlcohol: c.isAlcohol, isAddedSugar: c.isAddedSugar }, inferFlags(p.nameEn));
    const img = await prisma.image.create({ data: { kind: "ingredient", prompt: `${p.nameEn} as a raw ingredient on a wooden board, close-up` } });
    await prisma.ingredient.update({
      where: { id: p.id },
      data: {
        
        
        section: c.section,
        whatItIs: c.whatItIs,
        buyTips: c.buyTips,
        substitutes: c.substitutes,
        storage: c.storage,
        fdcId: nut?.fdcId ?? null,
        cardStatus: "generated",
        imageId: img.id,
        ...flags,
      },
    });
  }
}

export async function runJob(job: { id: string; type: string; userId: string; input: unknown }) {
  const log = (m: string) => appendLog(job.id, m);
  const input = (job.input ?? {}) as Record<string, string>;
  if (job.type === "teach") {
    const rules = await householdRuleText();
    const lessons = await loadSauceLessons([job.userId]);
    const lessonSlugs = lessons.map((l) => l.slug);
    // Rejected + regenerated (with the reasons fed back) until the household rules AND the sauce rule pass.
    const draft = await generateValidated({
      prompt: recipePrompt(input.dish, rules, sauceRuleText(lessons)),
      system: RECIPE_SYSTEM,
      schema: RecipeDraft,
      attempts: 3,
      onLog: log,
      check: async (d) => (await draftRuleCheck(d)) ?? sauceIssues(d, { lessonSlugs }),
    });
    const slug = `${slugify(draft.title)}-${job.id.slice(-4)}`;
    const saved = await saveRecipe(prisma, draft, { slug, level: Number(input.level) || 5, kind: "lesson", mealTypes: ["dinner"], source: "teach", sauceLesson: draft.sauceLesson.trim() || null });
    await log(`saved recipe ${slug} (${saved.newIngredients.length} new ingredients); step + hero images queued`);
    await fillPendingCards(log);
    return { slug };
  }
  if (job.type === "import-url") {
    const page = await fetchRecipePage(input.url);
    await log(`fetched ${page.length} chars of text`);
    const rules = await householdRuleText();
    const lessons = await loadSauceLessons([job.userId]);
    const lessonSlugs = lessons.map((l) => l.slug);
    // Same sauce rule as teach + feed: no sauce step / no lesson link → rejected and regenerated.
    const draft = await generateValidated({
      prompt: `${recipePrompt("the recipe on this web page (ignore the blog story, keep the real recipe)", rules, sauceRuleText(lessons))}\n\nPAGE TEXT:\n${page}`,
      system: RECIPE_SYSTEM,
      schema: RecipeDraft,
      attempts: 3,
      onLog: log,
      check: (d) => sauceIssues(d, { lessonSlugs }),
    });
    const ruleIssues = await draftRuleCheck(draft);
    await log(ruleIssues ? `rule check: ${ruleIssues}` : "rule check passed");
    return { draft, ruleIssues, url: input.url };
  }
  if (job.type === "lab-pdf") {
    const imp = await prisma.labImport.findUnique({ where: { id: input.importId } });
    if (!imp) throw new Error("import not found");
    await prisma.labImport.update({ where: { id: imp.id }, data: { status: "running" } });
    const ex = await generateValidated({
      prompt: `Extract every blood-test result from this lab report text. One item per marker: marker name in English (e.g. "Albumin", "Calcium", "Creatinine", "Ferritin", "Glucose", "Haemoglobin", "HDL cholesterol", "Iron", "LDL cholesterol", "Platelets", "Potassium", "Sodium", "TSH", "Vitamin B12", "Vitamin D", "White blood cells"), value as a number (null if none), unit as printed, reference range low/high as numbers (null if not printed), sample date YYYY-MM-DD if printed else null. Copy numbers exactly; do not convert units; do not guess.\n\nREPORT TEXT:\n${imp.text.slice(0, 14000)}`,
      system: "You extract data exactly as printed. Answer only with JSON.",
      schema: LabExtract,
      attempts: 2,
      onLog: log,
    });
    // Keep only values that literally appear in the PDF text — the user confirms every one anyway.
    const results = ex.results.map((r) => ({ ...r, unit: /^(null|none|n\/a|-)$/i.test(r.unit.trim()) ? "" : r.unit.trim(), foundInText: r.value == null || imp.text.includes(String(r.value)) }));
    await prisma.labImport.update({ where: { id: imp.id }, data: { status: "review", extracted: results } });
    return { importId: imp.id, count: results.length };
  }
  if (job.type === "photo") {
    const image = String(input.image ?? "");
    // Drop the photo from the DB as soon as the model has it (privacy + size).
    await prisma.job.update({ where: { id: job.id }, data: { input: {} } });
    await log(`asking ${VISION_MODEL} what is on the plate`);
    const schema = PhotoItems;
    const text = await ollamaVisionJson(
      "List every food on this plate or in this photo. For each: a short English name of the food as you would find it in a supermarket (e.g. 'chicken breast', 'white rice', 'tomato') and an estimated weight in grams. Only foods you can see; no guessing hidden ingredients.",
      image,
      schema,
    );
    const parsed = parseModelJson(schema, text);
    if (!parsed.ok) throw new Error(`vision answer not usable: ${parsed.error}`);
    const items = [];
    // Vision models sometimes list the same food several times — merge by name, keep it short.
    const merged = new Map<string, { name: string; grams: number }>();
    for (const it of parsed.data.items) {
      const k = it.name.trim().toLowerCase();
      const cur = merged.get(k);
      if (cur) cur.grams = Math.max(cur.grams, it.grams);
      else merged.set(k, { name: it.name.trim(), grams: it.grams });
    }
    for (const it of [...merged.values()].slice(0, 10)) {
      const word = it.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const match =
        (await prisma.ingredient.findFirst({ where: { nameEn: { equals: it.name, mode: "insensitive" }, fdcId: { not: null } } })) ??
        (await prisma.ingredient.findFirst({ where: { nameEn: { contains: word[word.length - 1] ?? it.name, mode: "insensitive" }, fdcId: { not: null } } }));
      items.push({ name: it.name, grams: Math.round(it.grams), ingredientId: match?.id ?? null, nameEn: match?.nameEn ?? null });
    }
    await log(`${items.length} item(s) found — waiting for confirmation`);
    return { items };
  }
  if (job.type === "report") {
    const { reportSummary } = await import("./report");
    return reportSummary(String(input.userId), log);
  }
  if (job.type === "cards") {
    await fillPendingCards(log);
    return { ok: true };
  }
  if (job.type === "feed") {
    const { runFeedJob } = await import("./feed");
    return runFeedJob(log);
  }
  if (job.type === "plan") {
    const res = await generatePlan(new Date(input.weekStart), log);
    return { planId: res.planId, ok: res.report.ok, generatedBy: res.generatedBy };
  }
  throw new Error(`unknown job type ${job.type}`);
}

let lastWasLlm = false;

/** Readable, never-empty error text for the Job row. */
export function errorText(e: unknown): string {
  const m = e instanceof Error ? e.message || e.name : String(e ?? "");
  return (m || "unknown error (no message)").slice(0, 1000);
}

/** Keep the DB small: old jobs, plus health data that will never be used — lab-PDF text never
 *  confirmed, and food photos of jobs still queued after 24 h. Daily. */
export async function prune(now = new Date()): Promise<{ jobs: number; labTexts: number; photos: number }> {
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  const jobs = await prisma.job.deleteMany({ where: { status: { in: ["done", "failed"] }, updatedAt: { lt: monthAgo } } });
  const labTexts = await prisma.labImport.updateMany({ where: { status: { in: ["failed", "review", "queued", "running"] }, createdAt: { lt: dayAgo }, NOT: { text: "" } }, data: { text: "" } });
  await prisma.labImport.updateMany({ where: { status: { in: ["queued", "running", "review"] }, createdAt: { lt: dayAgo } }, data: { status: "failed", error: "abandoned — not confirmed within 24 h; PDF text deleted" } });
  // A photo job that never ran still holds the image in Job.input — drop it with the job.
  const photos = await prisma.job.updateMany({ where: { type: "photo", status: "queued", createdAt: { lt: dayAgo } }, data: { status: "failed", input: {}, error: "abandoned — photo deleted after 24 h" } });
  return { jobs: jobs.count, labTexts: labTexts.count, photos: photos.count };
}

let lastPrune = 0;

/** One worker step: the next text job, else the next picture (only with IMAGE_GENERATION=on). Exported for tests. */
export async function tick(): Promise<boolean> {
  if (Date.now() - lastPrune > 86_400_000) {
    lastPrune = Date.now();
    const r = await prune().catch((e) => (logError("prune failed", { err: e }), null));
    if (r) logInfo("prune", r);
  }
  const job = await prisma.job.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
  if (job) {
    const claimed = await prisma.job.updateMany({ where: { id: job.id, status: "queued" }, data: { status: "running", attempts: { increment: 1 } } });
    if (!claimed.count) return true;
    if (!lastWasLlm) await releaseComfyMemory();
    lastWasLlm = true;
    logInfo("job start", { jobId: job.id, type: job.type });
    try {
      const result = await runJob(job);
      await prisma.job.update({ where: { id: job.id }, data: { status: "done", result: result as object } });
      logInfo("job done", { jobId: job.id, type: job.type });
    } catch (e) {
      const msg = errorText(e);
      logError("job failed", { jobId: job.id, type: job.type, err: e });
      await appendLog(job.id, `FAILED: ${msg}`);
      await prisma.job.update({ where: { id: job.id }, data: { status: "failed", error: msg } });
      if (job.type === "lab-pdf") {
        const id = (job.input as Record<string, string>)?.importId;
        if (id) await prisma.labImport.update({ where: { id }, data: { status: "failed", error: msg, text: "" } }).catch(() => {});
      }
    }
    return true;
  }
  // IMAGE_GENERATION off (the default): missing pictures keep their placeholder; no row is claimed, no attempt
  // counted and no request reaches ComfyUI.
  const img = imageGenerationOn() ? await prisma.image.findFirst({ where: { status: "queued", attempts: { lt: 3 } }, orderBy: [{ priority: "desc" }, { createdAt: "asc" }] }) : null;
  if (!img) {
    const { maybeScheduleFeed } = await import("./feed");
    await maybeScheduleFeed().catch((e) => logError("feed schedule failed", { err: e }));
    if (!lastWasLlm) await releaseComfyMemory();
    lastWasLlm = true; // idle: hand VRAM back once
    return false;
  }
  const claimed = await prisma.image.updateMany({ where: { id: img.id, status: "queued" }, data: { status: "running", attempts: { increment: 1 } } });
  if (!claimed.count) return true;
  if (lastWasLlm) await unloadTextModel();
  lastWasLlm = false;
  try {
    const size = img.kind === "ingredient" || img.kind === "technique" ? { width: 768, height: 768 } : { width: 1024, height: 768 };
    const file = await renderToFile(img.id, img.prompt, size, img.kind);
    await prisma.image.update({ where: { id: img.id }, data: { status: "done", file, doneAt: new Date(), error: null } });
  } catch (e) {
    const msg = errorText(e).slice(0, 500);
    logWarn("image failed", { imageId: img.id, err: e });
    await prisma.image.update({ where: { id: img.id }, data: { status: img.attempts + 1 >= 3 ? "failed" : "queued", error: msg } });
    // ComfyUI down: back off instead of spinning through the queue.
    if (/not reachable|fetch failed|ECONNREFUSED/i.test(msg)) await new Promise((r) => setTimeout(r, 60_000));
  }
  return true;
}

/** After a crash/restart: re-queue "running" work, but give up on jobs that already restarted 3×. */
export async function recover(): Promise<void> {
  await prisma.job.updateMany({ where: { status: "running", attempts: { gte: 3 } }, data: { status: "failed", error: "abandoned after 3 interrupted attempts (app restarted while it ran)" } });
  await prisma.job.updateMany({ where: { status: "running" }, data: { status: "queued" } });
  await prisma.image.updateMany({ where: { status: "running" }, data: { status: "queued" } });
}

export function startWorker() {
  const g = globalThis as unknown as { __kitchenWorker?: boolean };
  if (g.__kitchenWorker || process.env.WORKER === "off") return;
  g.__kitchenWorker = true;
  void (async () => {
    await recover().catch((e) => logError("worker recovery failed", { err: e }));
    for (;;) {
      let busy = false;
      try {
        busy = await tick();
      } catch (e) {
        logError("worker tick failed", { err: e });
      }
      await new Promise((r) => setTimeout(r, busy ? 250 : 4000));
    }
  })();
}

export async function pdfToText(file: string): Promise<string> {
  const { stdout } = await run("pdftotext", ["-layout", file, "-"], { maxBuffer: 10 * 1024 * 1024, timeout: 60_000 });
  return stdout;
}
