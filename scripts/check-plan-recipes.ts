// Prints every plan/prep recipe's per-person macros (every household member) and rule check (used to verify the seed).
import { loadCandidates, plannable, slotIssues, MEALS } from "../src/lib/planner";
import { eatersOf, loadProfiles, macrosFor, toRuleProfile } from "../src/lib/recipe-data";
import { prisma } from "../src/lib/prisma";

async function main() {
  const users = await loadProfiles();
  const people = users.map(toRuleProfile);
  const cands = plannable(await loadCandidates(eatersOf(users)));
  let bad = 0;
  for (const c of cands.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const meal = MEALS.find((m) => c.mealTypes.includes(m))!;
    const issues = slotIssues(c, meal, people, false).filter((i) => i.level === "fail");
    if (issues.length) bad++;
    const per = people.map((p) => { const m = macrosFor(c.macros, p.id); return `${p.slug} ${m.netCarbs}nc ${m.protein}P ${Math.round(m.kcal)}kcal`; }).join(" | ");
    console.log(`${issues.length ? "FAIL" : "ok  "} ${c.slug.padEnd(26)} ${per} ${issues.map((i) => i.msg).join("; ")}`);
  }
  console.log(`${bad} failing of ${cands.length}`);
  await prisma.$disconnect();
}
main();
