// Strict schemas for every model output. The JSON schema goes to Ollama as `format`, and the
// answer is validated again with zod — anything that does not parse is rejected and retried.
import { z } from "zod";

export const EQUIPMENT = [
  "oven", "hob", "blender", "stick-blender", "mixer", "slow-cooker", "air-fryer", "food-processor", "heavy-pan", "saucepan", "cast-iron", "non-stick", "stock-pot", "roasting-tray", "oven-dish", "chefs-knife", "paring-knife", "boards", "whisk", "spatula", "tongs", "fish-slice", "ladle", "sieve", "colander", "microplane", "peeler", "measuring", "scale", "thermometer", "oven-probe", "bowls", "containers", "paper-foil", "mortar",
] as const;

export const TECHNIQUES = [
  "none", "sear", "saute", "deglaze", "reduce", "roux", "emulsify", "starch-slurry", "stock",
  "rest-meat", "knife-cuts", "seasoning", "doneness", "slow-cooker", "blender", "air-fryer", "freezing", "garlic",
] as const;

export const SECTION_KEYS = [
  "produce", "herbs", "meat", "fish", "dairy", "cheese", "bakery", "pantry", "oils", "spices", "frozen", "other",
] as const;

const num = z.number().finite();

export const DraftIngredient = z.object({
  name: z.string().min(1).max(80),
  grams: num.min(0).max(5000),
  qty: num.min(0).max(5000),
  unit: z.string().min(1).max(20),
  prep: z.string().max(120).default(""),
  component: z.enum(["both", "alex", "sam"]).default("both"),
});

export const DraftStep = z.object({
  text: z.string().min(5).max(1200),
  why: z.string().max(600).default(""),
  cue: z.string().max(400).default(""),
  mistake: z.string().max(400).default(""),
  who: z.enum(["alex", "sam", "either"]).default("either"),
  minutes: z.number().int().min(0).max(600).default(5),
  technique: z.enum(TECHNIQUES).default("none"),
  timerSeconds: z.number().int().min(0).max(8 * 3600).default(0),
  imagePrompt: z.string().max(600).default(""),
});

export const RecipeDraft = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(800).default(""),
  servings: z.number().int().min(1).max(24),
  prepMinutes: z.number().int().min(0).max(600),
  cookMinutes: z.number().int().min(0).max(1440),
  fridgeDays: z.number().int().min(0).max(30).default(2),
  freezerDays: z.number().int().min(0).max(365).default(0),
  reheat: z.string().max(400).default(""),
  troubleshoot: z.array(z.object({ problem: z.string().max(200), fix: z.string().max(500) })).max(8).default([]),
  goesWith: z.string().max(400).default(""),
  equipment: z.array(z.enum(EQUIPMENT)).max(12).default([]),
  cuisine: z.string().max(40).default(""),
  protein: z.string().max(40).default(""),
  flavourTags: z.array(z.string().max(30)).max(8).default([]),
  spiceLevel: z.number().int().min(0).max(3).default(0),
  /** slug of the Sauce School lesson that teaches this dish's sauce (feed / teach; checked in code by sauce-rule.ts) */
  sauceLesson: z.string().max(80).default(""),
  ingredients: z.array(DraftIngredient).min(1).max(40),
  steps: z.array(DraftStep).min(1).max(20),
});
export type RecipeDraft = z.infer<typeof RecipeDraft>;

export const IngredientCard = z.object({
  nameEn: z.string().min(1).max(80),
  section: z.enum(SECTION_KEYS),
  whatItIs: z.string().max(800),
  buyTips: z.string().max(800),
  substitutes: z.string().max(500),
  storage: z.string().max(400),
  usdaSearch: z.string().max(80),
  isMeat: z.boolean(),
  isFish: z.boolean(),
  isAlcohol: z.boolean(),
  isAddedSugar: z.boolean(),
});
export type IngredientCard = z.infer<typeof IngredientCard>;
export const IngredientCards = z.object({ cards: z.array(IngredientCard).min(1).max(30) });

export const PlanDraft = z.object({
  days: z
    .array(z.object({ breakfast: z.string(), lunch: z.string(), dinner: z.string() }))
    .length(7),
});
export type PlanDraft = z.infer<typeof PlanDraft>;

export const LabExtract = z.object({
  results: z
    .array(
      z.object({
        marker: z.string().min(1).max(80),
        value: z.number().finite().nullable(),
        unit: z.string().max(30),
        refLow: z.number().finite().nullable(),
        refHigh: z.number().finite().nullable(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      }),
    )
    .max(80),
});
export type LabExtract = z.infer<typeof LabExtract>;

export const PhotoItems = z.object({ items: z.array(z.object({ name: z.string().min(1).max(60), grams: z.number().min(1).max(2000) })).max(20) });

/** JSON Schema for Ollama's `format` (zod 4 native). */
export function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: "draft-7", io: "input" }) as Record<string, unknown>;
}

/** Parse model text → validated object, or a readable error list for the retry prompt. */
export function parseModelJson<T>(schema: z.ZodType<T>, text: string): { ok: true; data: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    raw = JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${(e as Error).message}` };
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      error: r.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    };
  }
  return { ok: true, data: r.data };
}
