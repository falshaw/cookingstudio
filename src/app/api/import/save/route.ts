import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser } from "@/lib/api";
import { RecipeDraft } from "@/lib/llm-schema";
import { resolvePeople, saveRecipe } from "@/lib/recipe-save";
import { HOUSEHOLD_ORDER, legacyOwnerSlugs, normalizeLegacyDraft } from "@/lib/household";
import { draftRuleCheck } from "@/lib/worker";
import { slugify } from "@/lib/utils";
import { loadSauceLessons } from "@/lib/feed";

const Body = z.object({
  // parsed below: an old export (ingredient `component`, step `who`) is converted first
  draft: z.unknown(),
  level: z.number().int().min(1).max(8).default(5),
  kind: z.enum(["lesson", "plan", "prep"]).default("lesson"),
  sourceUrl: z.string().url().max(2000).optional(),
});

// Saves an edited import preview (or a JSON import). Rule check runs again on the edited version.
export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const users = await prisma.user.findMany({ select: { id: true, slug: true, createdAt: true } });
  const parsed = RecipeDraft.safeParse(normalizeLegacyDraft(r.body.draft, legacyOwnerSlugs(users)));
  if (!parsed.success) return bad(parsed.error.issues.map((i) => `draft.${i.path.join(".")}: ${i.message}`).join("; "));
  const draft = parsed.data;
  const unknown = (await resolvePeople(prisma, draft)).unknown;
  if (unknown.length) return bad(`Ingredient lines for people who are not in this household: ${unknown.join(", ")}`, 422);
  const issues = await draftRuleCheck(draft);
  if (issues) return bad(`Breaks household rules: ${issues}`, 422);
  // keep the import's sauce-lesson link (set by the import job's sauce check) only when it is a published lesson
  const wanted = draft.sauceLesson.trim();
  const sauceLesson = wanted && r.body.kind !== "lesson" && (await loadSauceLessons()).some((l) => l.slug === wanted) ? wanted : null;
  const slug = `${slugify(draft.title)}-${Date.now().toString(36).slice(-4)}`;
  const saved = await saveRecipe(prisma, draft, { slug, level: r.body.level, kind: r.body.kind, mealTypes: r.body.kind === "lesson" ? ["dinner"] : ["lunch", "dinner"], source: "import", sourceUrl: r.body.sourceUrl, sauceLesson });
  if (saved.newIngredients.length) {
    // guide cards for new ingredients are written by the worker (LLM work never blocks a request)
    const owner = await prisma.user.findFirst({ orderBy: HOUSEHOLD_ORDER });
    if (owner) await prisma.job.create({ data: { userId: owner.id, type: "cards", input: {} } });
  }
  return ok({ ok: true, slug });
}
