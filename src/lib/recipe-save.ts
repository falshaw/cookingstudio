// Save a validated RecipeDraft (seed JSON, teach-me, URL import) into the DB: resolve or create
// ingredients, link steps to the ingredients they use, queue ComfyUI images for steps + hero.
// Takes the Prisma client as a parameter so the host-side seed script can reuse it.
import type { PrismaClient } from "@prisma/client";
import type { RecipeDraft } from "./llm-schema";
import { inferFlags } from "./flags";
import { slugify } from "./utils";

/** Plural/qualifier-insensitive key: "Cherry tomatoes" → "cherry-tomato". */
export function ingredientKey(name: string): string {
  return slugify(
    name
      .toLowerCase()
      .replace(/\(.*?\)/g, "")
      .replace(/\b(fresh|large|small|medium|extra[- ]virgin|good[- ]quality|ripe|organic|chopped|sliced|diced)\b/g, "")
      .replace(/(oes|ies|s)\b/g, (m) => (m === "ies" ? "y" : m === "oes" ? "o" : "")),
  );
}

type Db = PrismaClient;

/** ingredientKey(model name) → guide slug for the usual generic names. */
export const SYNONYMS: Record<string, string> = {
  flour: "plain-flour",
  "all-purpose-flour": "plain-flour",
  "plain-white-flour": "plain-flour",
  cornstarch: "corn-flour",
  "corn-starch": "corn-flour",
  "beef-chuck": "beef-chunks",
  "stewing-beef": "beef-chunks",
  "ground-beef": "beef-mince",
  "minced-beef": "beef-mince",
  "olive-oil": "olive-oil",
  "vegetable-oil": "sunflower-oil",
  "chicken-broth": "chicken-stock",
  "beef-broth": "beef-stock",
  "vegetable-broth": "vegetable-stock",
  "heavy-cream": "cream",
  "double-cream": "cream",
  "plain-yogurt": "greek-yogurt",
  yogurt: "greek-yogurt",
  "strained-greek-yogurt": "greek-yogurt",
  "greek-yoghurt": "greek-yogurt",
  "black-pepper": "black-pepper",
  pepper: "black-pepper",
  "sea-salt": "salt",
  "spring-onion": "spring-onion",
  scallion: "spring-onion",
  "bell-pepper": "red-pepper",
  "red-bell-pepper": "red-pepper",
  zucchini: "courgette",
  eggplant: "aubergine",
  cilantro: "coriander",
  "fresh-coriander": "coriander",
  "lemon-juice": "lemon",
  "lime-juice": "lime",
  "garlic-clove": "garlic",
  "bacon-lardon": "pancetta",
  lardon: "pancetta",
  "parmesan-cheese": "parmesan",
  "feta-cheese": "feta",
  "canned-tomato": "canned-tomatoes",
  "canned-diced-tomato": "canned-tomatoes",
  "canned-crushed-tomato": "canned-tomatoes",
  "chopped-tomato": "canned-tomatoes",
  "cauliflower-floret": "cauliflower",
  "broccoli-floret": "broccoli",
  "red-onion": "red-onion",
  "yellow-onion": "onion",
  "brown-onion": "onion",
};

export async function resolveIngredient(db: Db, name: string): Promise<{ id: string; created: boolean }> {
  const key = ingredientKey(name) || slugify(name);
  const bySlug = await db.ingredient.findUnique({ where: { slug: key } });
  if (bySlug) return { id: bySlug.id, created: false };
  const byName = await db.ingredient.findFirst({ where: { nameEn: { equals: name.trim(), mode: "insensitive" } } });
  if (byName) return { id: byName.id, created: false };
  // Common generic names → the guide's entry (models write "flour", "beef chuck", "olive oil (extra virgin)")
  const syn = SYNONYMS[key];
  if (syn) {
    const s = await db.ingredient.findUnique({ where: { slug: syn } });
    if (s) return { id: s.id, created: false };
  }
  // A guide entry whose name contains the whole model name as words, if exactly one does.
  const words = name.trim().toLowerCase().replace(/\(.*?\)/g, "").trim();
  if (words.length >= 4) {
    const hits = await db.ingredient.findMany({ where: { nameEn: { contains: words, mode: "insensitive" } }, select: { id: true }, take: 2 });
    if (hits.length === 1) return { id: hits[0].id, created: false };
  }
  const flags = inferFlags(name);
  const row = await db.ingredient.create({
    data: { slug: key, nameEn: name.trim(), section: "other", cardStatus: "pending", ...flags },
  });
  return { id: row.id, created: true };
}

/** RecipeIngredient ids whose name (or its main word) appears in the step text. */
export function stepIngredientIds(text: string, lines: { id: string; nameEn: string }[]): string[] {
  const t = text.toLowerCase();
  const out: string[] = [];
  for (const l of lines) {
    const n = l.nameEn.toLowerCase();
    const words = n.split(/[^a-z]+/i).filter((w) => w.length >= 4);
    const stem = (w: string) => w.replace(/(es|s)$/, "");
    const hit =
      t.includes(n) ||
      (words.length > 0 && t.includes(stem(words[words.length - 1])));
    if (hit) out.push(l.id);
  }
  return out;
}

/** Hero shots show THE dish itself — nothing else on the table. */
export function heroPrompt(title: string, custom?: string): string {
  return `${custom || `the finished dish: ${title}`}. Only this one dish, the hero of the photo, no other dishes or extra ingredients`;
}

/** Step shots show exactly the action and the ingredients the step names — no extras. */
export function stepPrompt(base: string, ingredients: string[]): string {
  return `${base.replace(/\.$/, "")}${ingredients.length ? `. Only these ingredients visible: ${ingredients.join(", ")}` : ""}. Nothing else in the shot`;
}

export interface SaveOpts {
  slug: string;
  level: number;
  kind: "lesson" | "plan" | "prep";
  mealTypes: string[];
  source: "seed" | "teach" | "import" | "feed";
  sourceUrl?: string;
  sauceFamily?: string | null;
  sauceLesson?: string | null;
  variantNote?: string;
  /** map draft ingredient name → canonical ingredient slug (seed curation) */
  aliases?: Record<string, string>;
  heroPrompt?: string;
  leftoverIdeas?: string;
  status?: "published" | "draft";
}

export async function saveRecipe(db: Db, d: RecipeDraft, o: SaveOpts): Promise<{ id: string; newIngredients: string[] }> {
  const newIngredients: string[] = [];
  const resolved: { ingredientId: string; d: RecipeDraft["ingredients"][number] }[] = [];
  for (const ing of d.ingredients) {
    const alias = o.aliases?.[ing.name.toLowerCase()];
    let id: string | null = null;
    if (alias) id = (await db.ingredient.findUnique({ where: { slug: alias } }))?.id ?? null;
    if (!id) {
      const r = await resolveIngredient(db, ing.name);
      id = r.id;
      if (r.created) newIngredients.push(id);
    }
    resolved.push({ ingredientId: id, d: ing });
  }

  const recipe = await db.$transaction(async (tx) => {
    await tx.recipe.deleteMany({ where: { slug: o.slug } });
    const r = await tx.recipe.create({
      data: {
        slug: o.slug,
        title: d.title,
        
        description: d.description,
        level: o.level,
        kind: o.kind,
        mealTypes: o.mealTypes,
        servings: d.servings,
        prepMinutes: d.prepMinutes,
        cookMinutes: d.cookMinutes,
        fridgeDays: d.fridgeDays,
        freezerDays: d.freezerDays,
        reheat: d.reheat,
        equipment: d.equipment,
        sauceFamily: o.sauceFamily ?? null,
        sauceLesson: o.sauceLesson ?? null,
        troubleshoot: d.troubleshoot,
        goesWith: d.goesWith,
        variantNote: o.variantNote ?? "",
        leftoverIdeas: o.leftoverIdeas ?? "",
        status: o.status ?? "published",
        cuisine: d.cuisine,
        protein: d.protein,
        flavourTags: d.flavourTags,
        spiceLevel: d.spiceLevel,
        source: o.source,
        sourceUrl: o.sourceUrl,
      },
    });
    const lines: { id: string; nameEn: string }[] = [];
    for (let i = 0; i < resolved.length; i++) {
      const { ingredientId, d: ing } = resolved[i];
      const row = await tx.recipeIngredient.create({
        data: { recipeId: r.id, ingredientId, component: ing.component, grams: ing.grams, qty: ing.qty, unit: ing.unit, prep: ing.prep, sort: i },
        include: { ingredient: { select: { nameEn: true } } },
      });
      lines.push({ id: row.id, nameEn: row.ingredient.nameEn });
    }
    const hero = await tx.image.create({
      data: { kind: "hero", prompt: heroPrompt(d.title, o.heroPrompt), priority: 2 },
    });
    await tx.recipe.update({ where: { id: r.id }, data: { heroImageId: hero.id } });
    for (let i = 0; i < d.steps.length; i++) {
      const s = d.steps[i];
      const used = stepIngredientIds(s.text, lines).map((id) => lines.find((l) => l.id === id)?.nameEn).filter((x): x is string => !!x);
      const img = await tx.image.create({ data: { kind: "step", prompt: stepPrompt(s.imagePrompt || s.text, used), priority: 1 } });
      await tx.step.create({
        data: {
          recipeId: r.id,
          n: i + 1,
          text: s.text,
          why: s.why,
          cue: s.cue,
          mistake: s.mistake,
          who: s.who,
          minutes: s.minutes,
          timerSeconds: s.timerSeconds,
          technique: s.technique === "none" ? null : s.technique,
          ingredientIds: stepIngredientIds(s.text, lines),
          imagePrompt: s.imagePrompt,
          imageId: img.id,
        },
      });
    }
    return r;
  });
  return { id: recipe.id, newIngredients };
}
