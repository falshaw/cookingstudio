// Seed: the two household users (from .env), starter profiles, USDA nutrition table, levels, techniques,
// equipment, ingredient guide, recipes, and the pictures: the shipped ones in prisma/seed-images are linked
// right away; anything without a shipped picture stays queued for ComfyUI (only if it is set up).
// Runs in the one-shot init container, or on the host with the OWNER url:
//   DATABASE_URL=postgresql://kitchen:…@127.0.0.1:15432/kitchen npx tsx prisma/seed.ts
// Idempotent: existing recipes are kept (pass --force-recipes to rebuild them; that drops their cook logs).
import "dotenv/config";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { hashPassword } from "../src/lib/auth-core";
import { RecipeDraft } from "../src/lib/llm-schema";
import { saveRecipe } from "../src/lib/recipe-save";
import { inferFlags } from "../src/lib/flags";
import { scoreName } from "../src/lib/nutrition-search";

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const DIR = path.join(__dirname, "seed-data");
const read = <T>(f: string): T => JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as T;
const FORCE = process.argv.includes("--force-recipes");
const ONLY = (process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",") ?? []).filter(Boolean);

interface IngSeed {
  slug: string; en: string; sec: string; kind: string; what: string; buy: string; sub: string; store: string;
  where: string; keeps: number | null; opened: number | null; frz: boolean; frzMonths?: number; frzHow?: string; pack: [string, number | null, string]; fdc: string; taste: string;
}
type Line = [string, number, string, number, string, string];
interface StepSeed { t: string; w: string; c: string; m: string; who: string; min: number; tech: string; tmr: number; img: string }
interface RecipeSeed {
  slug: string; level: number; kind: "lesson" | "plan" | "prep"; meals: string[]; sauce?: string; lesson?: string; title: string; desc: string; serv: number; prep: number; cook: number;
  fridge: number; freezer: number; reheat: string; left: string; variant?: string; cuisine: string; protein: string; flav: string[]; spice: number; equip: string[];
  trouble: [string, string][]; goes: string; ing: Line[]; steps: StepSeed[];
}

// The .env.example value ("change-me-12-chars-or-more") and any other "change me" / placeholder wording.
const PLACEHOLDER_PW = /change[-_ ]?me|placeholder/i;

async function users() {
  const defs = [
    { slug: "alex", name: "Alex", email: process.env.SEED_ALEX_EMAIL, pw: process.env.SEED_ALEX_PASSWORD },
    { slug: "sam", name: "Sam", email: process.env.SEED_SAM_EMAIL, pw: process.env.SEED_SAM_PASSWORD },
  ];
  for (const d of defs) {
    if (!d.email || !d.pw) throw new Error(`SEED_${d.slug.toUpperCase()}_EMAIL / _PASSWORD missing in .env`);
    if (d.pw.length < 12) throw new Error(`SEED_${d.slug.toUpperCase()}_PASSWORD must be at least 12 characters`);
    if (PLACEHOLDER_PW.test(d.pw)) {
      throw new Error(`SEED_${d.slug.toUpperCase()}_PASSWORD is still the .env.example placeholder. Set a real password in .env (e.g. openssl rand -hex 16) and start again.`);
    }
    const passwordHash = await hashPassword(d.pw);
    await prisma.user.upsert({ where: { slug: d.slug }, create: { slug: d.slug, name: d.name, email: d.email.toLowerCase(), passwordHash }, update: { email: d.email.toLowerCase(), passwordHash } });
  }
  const alex = await prisma.user.findUniqueOrThrow({ where: { slug: "alex" } });
  const sam = await prisma.user.findUniqueOrThrow({ where: { slug: "sam" } });
  // Starter profiles, created once and then owned by the user (a re-seed never overwrites them). Everything
  // diet-related stays empty: each person sets their own rules on /profiles.
  for (const u of [alex, sam]) {
    if (await prisma.userProfile.findUnique({ where: { userId: u.id } })) continue;
    await prisma.userProfile.create({ data: { userId: u.id, maxCookMinutes: 30, practiceGoalPerWeek: 3, trackedNutrients: ["fibre", "magnesium", "vitD"] } });
  }
  return { alex, sam };
}

const NUT_COLS = ["kcal", "protein", "carbs", "fat", "satFat", "fibre", "sugar", "b12", "iron", "zinc", "ala", "magnesium", "vitD", "epa", "dha", "mufa", "pufa"] as const;
type UsdaRow = { fdcId: number; name: string } & Partial<Record<(typeof NUT_COLS)[number], number>>;

/** Insert missing USDA rows, then ALWAYS backfill every nutrient column (new columns get data too). */
async function nutrition() {
  const rows = read<UsdaRow[]>("usda-sr-legacy.json");
  for (let i = 0; i < rows.length; i += 1000) {
    await prisma.nutritionRef.createMany({
      data: rows.slice(i, i + 1000).map((r) => ({ fdcId: r.fdcId, name: r.name, kcal: r.kcal ?? 0, protein: r.protein ?? 0, carbs: r.carbs ?? 0, fat: r.fat ?? 0 })),
      skipDuplicates: true,
    });
  }
  const sqlNum = (v: number | undefined) => (v == null || !Number.isFinite(v) ? "NULL" : String(v));
  for (let i = 0; i < rows.length; i += 500) {
    const values = rows.slice(i, i + 500).map((r) => `(${r.fdcId},${NUT_COLS.map((c) => sqlNum(r[c])).join(",")})`).join(",");
    const set = NUT_COLS.map((c) => (["kcal", "protein", "carbs", "fat"].includes(c) ? `"${c}"=COALESCE(v."${c}", n."${c}")` : `"${c}"=v."${c}"`)).join(",");
    await prisma.$executeRawUnsafe(
      `UPDATE "NutritionRef" n SET ${set} FROM (VALUES ${values}) AS v("fdcId",${NUT_COLS.map((c) => `"${c}"`).join(",")}) WHERE n."fdcId"=v."fdcId"`,
    );
  }
  return rows;
}

function matchFdc(term: string, rows: { fdcId: number; name: string }[]): { fdcId: number; name: string } | null {
  const tokens = term.toLowerCase().split(/[^a-z0-9%.]+/).filter((t) => t.length >= 2);
  if (!tokens.length) return null;
  let best: { fdcId: number; name: string; s: number } | null = null;
  for (const r of rows) {
    const n = r.name.toLowerCase();
    if (!tokens.every((t) => n.includes(t))) continue;
    const s = scoreName(r.name, tokens);
    if (!best || s > best.s) best = { ...r, s };
  }
  return best;
}

async function reference(rows: { fdcId: number; name: string }[]) {
  for (const l of read<{ number: number; title: string; subtitle: string; description: string; refresher: boolean }[]>("levels.json")) {
    await prisma.level.upsert({ where: { number: l.number }, create: l, update: l });
  }
  for (const t of read<{ slug: string; title: string; summary: string; body: string; tips: string; img: string }[]>("techniques.json")) {
    const existing = await prisma.technique.findUnique({ where: { slug: t.slug } });
    const imageId = existing?.imageId ?? (await prisma.image.create({ data: { kind: "technique", prompt: t.img, priority: 1 } })).id;
    const data = { title: t.title, summary: t.summary, body: t.body, tips: t.tips, imageId };
    await prisma.technique.upsert({ where: { slug: t.slug }, create: { slug: t.slug, ...data }, update: data });
  }
  const eq = read<{ slug: string; name: string; cat: string; why: string; price: string; where: string; have: boolean }[]>("equipment.json");
  for (let i = 0; i < eq.length; i++) {
    const e = eq[i];
    const data = { name: e.name, category: e.cat, why: e.why, priceEur: e.price, whereToBuy: e.where, sort: i };
    // `have` is household data — set on create only.
    await prisma.equipment.upsert({ where: { slug: e.slug }, create: { slug: e.slug, have: e.have, ...data }, update: data });
  }
  const review: string[] = [];
  for (const i of read<IngSeed[]>("ingredients.json")) {
    const m = /^\d+$/.test(i.fdc) ? rows.find((r) => r.fdcId === Number(i.fdc)) ?? null : i.fdc ? matchFdc(i.fdc, rows) : null;
    review.push(`${i.slug.padEnd(22)} → ${m ? `${m.fdcId} ${m.name}` : "(no USDA match)"}`);
    const existing = await prisma.ingredient.findUnique({ where: { slug: i.slug } });
    const imageId = existing?.imageId ?? (await prisma.image.create({ data: { kind: "ingredient", prompt: `${i.en} as a raw ingredient, close-up on a wooden kitchen board`, priority: 0 } })).id;
    const flags = inferFlags(i.en);
    const data = {
      nameEn: i.en, section: i.sec, kind: i.kind, whatItIs: i.what, buyTips: i.buy, substitutes: i.sub, storage: i.store,
      storeWhere: i.where, keepsDays: i.keeps, keepsOpenedDays: i.opened, freezable: i.frz, freezeHow: i.frzHow ?? "", freezerMonths: i.frzMonths ?? null,
      packLabel: i.pack[0], packQty: i.pack[1], packUnit: i.pack[2], tastesLike: i.taste, fdcId: m?.fdcId ?? null, cardStatus: "seed", imageId, ...flags,
    };
    await prisma.ingredient.upsert({ where: { slug: i.slug }, create: { slug: i.slug, ...data }, update: data });
  }
  return review;
}

async function recipes() {
  const files = readdirSync(path.join(DIR, "recipes")).filter((f) => f.endsWith(".json")).sort();
  const ings = await prisma.ingredient.findMany({ select: { slug: true, nameEn: true } });
  const bySlug = new Map(ings.map((i) => [i.slug, i]));
  let made = 0, kept = 0;
  for (const f of files) {
    for (const r of read<RecipeSeed[]>(path.join("recipes", f))) {
      if (ONLY.length && !ONLY.includes(r.slug)) continue;
      if (!FORCE && !ONLY.length && (await prisma.recipe.findUnique({ where: { slug: r.slug } }))) {
        kept++;
        continue;
      }
      const aliases: Record<string, string> = {};
      const draft = RecipeDraft.parse({
        title: r.title, description: r.desc, servings: r.serv, prepMinutes: r.prep, cookMinutes: r.cook,
        fridgeDays: r.fridge, freezerDays: r.freezer, reheat: r.reheat, troubleshoot: r.trouble.map(([problem, fix]) => ({ problem, fix })),
        goesWith: r.goes, equipment: r.equip, cuisine: r.cuisine, protein: r.protein, flavourTags: r.flav, spiceLevel: r.spice,
        ingredients: r.ing.map(([slug, qty, unit, grams, prep, comp]) => {
          const ing = bySlug.get(slug);
          if (!ing) throw new Error(`${r.slug}: unknown ingredient slug "${slug}"`);
          aliases[ing.nameEn.toLowerCase()] = slug;
          return { name: ing.nameEn, grams, qty, unit, prep, component: comp || "both" };
        }),
        steps: r.steps.map((s) => ({ text: s.t, why: s.w, cue: s.c, mistake: s.m, who: s.who, minutes: s.min, technique: s.tech, timerSeconds: s.tmr, imagePrompt: s.img })),
      });
      await saveRecipe(prisma, draft, {
        slug: r.slug, level: r.level, kind: r.kind, mealTypes: r.meals, source: "seed", sauceFamily: r.sauce ?? null, sauceLesson: r.lesson ?? null,
        variantNote: r.variant ?? "", leftoverIdeas: r.left, aliases, heroPrompt: `the finished dish: ${r.title}, plated on a ceramic plate, home dining table`,
      });
      made++;
    }
  }
  return { made, kept };
}

/**
 * Link the pictures that ship in prisma/seed-images (named by slug: hero-<recipe>.webp + optional .mp4 loop,
 * step-<recipe>-<n>.webp, ingredient-<slug>.webp, technique-<slug>.webp) to their Image rows and mark them done,
 * so a fresh install shows every picture without ComfyUI. Only rows that are not done yet are touched:
 * pictures you rendered yourself are kept. The app serves the files from this folder (src/lib/image-files.ts).
 */
async function pictures() {
  const dir = path.join(__dirname, "seed-images");
  const have = new Set(existsSync(dir) ? readdirSync(dir) : []);
  let linked = 0;
  const link = async (imageId: string | null, name: string, video?: string) => {
    if (!imageId || !have.has(`${name}.webp`)) return;
    const img = await prisma.image.findUnique({ where: { id: imageId }, select: { status: true } });
    if (!img || img.status === "done") return;
    const clip = video && have.has(video) ? video : null;
    await prisma.image.update({ where: { id: imageId }, data: { status: "done", file: `${name}.webp`, video: clip, error: null, doneAt: new Date() } });
    linked++;
  };
  for (const t of await prisma.technique.findMany({ select: { slug: true, imageId: true } })) await link(t.imageId, `technique-${t.slug}`);
  for (const i of await prisma.ingredient.findMany({ select: { slug: true, imageId: true } })) await link(i.imageId, `ingredient-${i.slug}`);
  const recipes = await prisma.recipe.findMany({ select: { slug: true, heroImageId: true, steps: { select: { n: true, imageId: true } } } });
  for (const r of recipes) {
    await link(r.heroImageId, `hero-${r.slug}`, `hero-${r.slug}.mp4`);
    for (const s of r.steps) await link(s.imageId, `step-${r.slug}-${s.n}`);
  }
  return linked;
}

/** Two demo receipts (approximate German discounter prices) so /spending and meal costs have data.
 *  Only on an empty Purchase table — a household's own receipts are never touched. */
async function demoReceipts(): Promise<number> {
  if ((await prisma.purchase.count()) > 0) return 0;
  type Line = { name: string; kind: string; price: number; grams?: number; ingredient?: string };
  const receipts = read<{ store: string; boughtOn: string; total: number; note: string; items: Line[] }[]>("demo-receipts.json");
  for (const r of receipts) {
    const sum = Math.round(r.items.reduce((a, i) => a + i.price, 0) * 100) / 100;
    if (sum !== r.total) throw new Error(`demo receipt ${r.store}: lines ${sum} != total ${r.total}`);
    const ids = new Map((await prisma.ingredient.findMany({ where: { slug: { in: r.items.flatMap((i) => (i.ingredient ? [i.ingredient] : [])) } }, select: { id: true, slug: true } })).map((x) => [x.slug, x.id]));
    await prisma.purchase.create({
      data: {
        store: r.store,
        boughtOn: new Date(`${r.boughtOn}T00:00:00Z`),
        total: r.total,
        note: r.note,
        items: { create: r.items.map((i, n) => ({ name: i.name, kind: i.kind, price: i.price, grams: i.grams ?? null, ingredientId: i.ingredient ? ids.get(i.ingredient) ?? null : null, sort: n })) },
      },
    });
  }
  return receipts.length;
}

async function main() {
  await users();
  const rows = await nutrition();
  console.log(`nutrition rows: ${await prisma.nutritionRef.count()}`);
  const review = await reference(rows);
  const out = process.env.SEED_REVIEW_FILE;
  if (out) writeFileSync(out, review.join("\n"));
  console.log(`ingredients: ${await prisma.ingredient.count()} (USDA matched ${review.filter((l) => !l.includes("no USDA")).length})`);
  const r = await recipes();
  console.log(`recipes: ${r.made} created, ${r.kept} kept`);
  console.log(`pictures linked from prisma/seed-images: ${await pictures()}`);
  console.log(`images queued: ${await prisma.image.count({ where: { status: "queued" } })}`);
  console.log(`demo receipts: ${await demoReceipts()} added`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
