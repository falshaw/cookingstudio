import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";

// JSON export in the same shape /import accepts ({recipes:[{draft, level, kind}]}). Recipes only —
// no health data ever leaves through here.
export async function GET(req: Request) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const slug = new URL(req.url).searchParams.get("slug");
  const rows = await prisma.recipe.findMany({
    where: slug ? { slug } : { status: "published" },
    include: { ingredients: { include: { ingredient: true, forUser: { select: { slug: true } } }, orderBy: { sort: "asc" } }, steps: { orderBy: { n: "asc" } } },
  });
  const recipes = rows.map((r) => ({
    level: r.level,
    kind: r.kind,
    draft: {
      title: r.title,
      
      description: r.description,
      servings: r.servings,
      prepMinutes: r.prepMinutes,
      cookMinutes: r.cookMinutes,
      fridgeDays: r.fridgeDays ?? 2,
      freezerDays: r.freezerDays ?? 0,
      reheat: r.reheat ?? "",
      troubleshoot: Array.isArray(r.troubleshoot) ? r.troubleshoot : [],
      goesWith: r.goesWith,
      equipment: r.equipment,
      cuisine: r.cuisine,
      protein: r.protein,
      flavourTags: r.flavourTags,
      spiceLevel: r.spiceLevel,
      ingredients: r.ingredients.map((i) => ({ name: i.ingredient.nameEn, grams: i.grams, qty: i.qty, unit: i.unit, prep: i.prep, for: i.forUser?.slug ?? "" })),
      steps: r.steps.map((s) => ({ text: s.text, why: s.why, cue: s.cue, mistake: s.mistake, skill: s.skill, minutes: s.minutes, technique: s.technique ?? "none", timerSeconds: s.timerSeconds, imagePrompt: s.imagePrompt })),
    },
  }));
  return new NextResponse(JSON.stringify({ app: "cookingstudio", exportedAt: new Date().toISOString(), recipes }, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="kitchen-${slug ?? "recipes"}.json"` },
  });
}
