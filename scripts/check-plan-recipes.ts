// Prints every plan/prep recipe's per-person macros and rule check (used to verify the seed).
import { loadCandidates, plannable, slotIssues, MEALS } from "../src/lib/planner";
import { loadProfiles, toRuleProfile } from "../src/lib/recipe-data";
import { prisma } from "../src/lib/prisma";

async function main() {
  const people = (await loadProfiles()).map(toRuleProfile);
  const cands = plannable(await loadCandidates({ alex: 1, sam: 1 }));
  let bad = 0;
  for (const c of cands.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const meal = MEALS.find((m) => c.mealTypes.includes(m))!;
    const issues = slotIssues(c, meal, people, false).filter((i) => i.level === "fail");
    if (issues.length) bad++;
    console.log(`${issues.length ? "FAIL" : "ok  "} ${c.slug.padEnd(26)} A ${c.macros.alex.netCarbs}nc ${c.macros.alex.protein}P ${Math.round(c.macros.alex.kcal)}kcal | S ${c.macros.sam.netCarbs}nc ${c.macros.sam.protein}P ${issues.map((i) => i.msg).join("; ")}`);
  }
  console.log(`${bad} failing of ${cands.length}`);
  await prisma.$disconnect();
}
main();
