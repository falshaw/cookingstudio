// npm run check:sauce — every published everyday (plan/prep) recipe with juices / tomatoes / cheese / cream must
// have a "make the sauce" step and a sauceLesson that is a published lesson (src/lib/sauce-rule.ts). Exit 1 on any FAIL.
import { prisma } from "../src/lib/prisma";
import { loadSauceLessons } from "../src/lib/feed";
import { NO_SAUCE, needsSauce, recipeSauceProblem } from "../src/lib/sauce-rule";

async function main() {
  const lessonSlugs = (await loadSauceLessons()).map((l) => l.slug);
  const recipes = await prisma.recipe.findMany({
    where: { status: "published", kind: { in: ["plan", "prep"] } },
    select: { slug: true, kind: true, sauceFamily: true, sauceLesson: true, steps: { select: { text: true, cue: true }, orderBy: { n: "asc" } } },
    orderBy: { slug: "asc" },
  });
  let bad = 0, checked = 0, exempt = 0;
  for (const r of recipes) {
    if (NO_SAUCE[r.slug]) {
      exempt++;
      continue;
    }
    if (!needsSauce(r.steps)) continue;
    checked++;
    const p = recipeSauceProblem(r, lessonSlugs);
    if (p) {
      bad++;
      console.log(`FAIL ${r.slug}: ${p}`);
    }
  }
  console.log(`${bad} failing of ${checked} checked (${recipes.length} published plan/prep, ${exempt} exempt: no sauce to make)`);
  await prisma.$disconnect();
  if (bad) process.exit(1);
}
main();
