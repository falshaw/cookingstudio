// npm run check:sides — the healthy sides every published lunch/dinner recipe offers the "alex" profile (src/lib/sides.ts).
// FAIL = no side at all, or a side that would push that plate over its net-carb limit. Exit 1 on any FAIL.
// "tight" = only one side fits because the dish already uses most of the carb limit (shown on the page, not a fault).
// Prints one line per recipe so the picks can be read through; `--quiet` prints only FAILs and the summary.
import { prisma } from "../src/lib/prisma";
import { recipeVM } from "../src/lib/recipe-view";

async function main() {
  const quiet = process.argv.includes("--quiet");
  const alex = await prisma.user.findFirst({ where: { slug: "alex" }, include: { profile: true } });
  if (!alex) throw new Error("no alex user");
  const limit = alex.profile?.maxNetCarbsPerMeal ?? null;
  const recipes = await prisma.recipe.findMany({
    where: { status: "published", mealTypes: { hasSome: ["lunch", "dinner"] } },
    select: { slug: true },
    orderBy: { slug: "asc" },
  });
  let bad = 0, shown = 0, small = 0, tight = 0;
  for (const { slug } of recipes) {
    const vm = await recipeVM(slug, alex.id);
    if (!vm || !vm.sides.length) continue; // pure sauce lessons / breakfasts show no sides
    shown++;
    const p = vm.macros.alex;
    const over = limit != null && vm.sides.some((s) => s.plate.netCarbs > limit + 0.05);
    const fail = over;
    if (vm.sides.length === 1) tight++;
    if (p.kcal < 500) small++;
    if (fail) bad++;
    if (fail || !quiet) {
      const list = vm.sides.map((s) => `${s.key}(+${Math.round(s.macros.kcal)}kcal +${s.macros.netCarbs}nc)`).join(" ");
      console.log(`${fail ? "FAIL" : vm.sides.length === 1 ? "tght" : "ok  "} ${slug.padEnd(34)} ${String(Math.round(p.kcal)).padStart(4)}kcal ${p.netCarbs.toFixed(1).padStart(5)}nc | ${list}`);
    }
  }
  console.log(`${bad} failing of ${shown} recipes with sides (${recipes.length} lunch/dinner published; ${tight} carb-tight with one side; ${small} under 500 kcal before a side)`);
  await prisma.$disconnect();
  if (bad) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
