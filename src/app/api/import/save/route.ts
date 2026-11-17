import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser } from "@/lib/api";
import { RecipeDraft } from "@/lib/llm-schema";
import { saveRecipe } from "@/lib/recipe-save";
import { draftRuleCheck } from "@/lib/worker";
import { slugify } from "@/lib/utils";
import { loadSauceLessons } from "@/lib/feed";

const Body = z.object({
  draft: RecipeDraft,
  level: z.number().int().min(1).max(8).default(5),
  kind: z.enum(["lesson", "plan", "prep"]).default("lesson"),
  sourceUrl: z.string().url().max(2000).optional(),
});

// Saves an edited import preview (or a JSON import). Rule check runs again on the edited version.
export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const issues = await draftRuleCheck(r.body.draft);
  if (issues) return bad(`Breaks household rules: ${issues}`, 422);
  // keep the import's sauce-lesson link (set by the import job's sauce check) only when it is a published lesson
  const wanted = r.body.draft.sauceLesson.trim();
  const sauceLesson = wanted && r.body.kind !== "lesson" && (await loadSauceLessons()).some((l) => l.slug === wanted) ? wanted : null;
  const slug = `${slugify(r.body.draft.title)}-${Date.now().toString(36).slice(-4)}`;
  const saved = await saveRecipe(prisma, r.body.draft, { slug, level: r.body.level, kind: r.body.kind, mealTypes: r.body.kind === "lesson" ? ["dinner"] : ["lunch", "dinner"], source: "import", sourceUrl: r.body.sourceUrl, sauceLesson });
  if (saved.newIngredients.length) {
    // guide cards for new ingredients are written by the worker (LLM work never blocks a request)
    const alex = await prisma.user.findUnique({ where: { slug: "alex" } });
    if (alex) await prisma.job.create({ data: { userId: alex.id, type: "cards", input: {} } });
  }
  return ok({ ok: true, slug });
}
