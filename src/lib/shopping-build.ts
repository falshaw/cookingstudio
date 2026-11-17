// Builds shopping lists from selected recipes or a week's meal plan (incl. prep batches),
// adds LOW/OUT stock, marks what is already in stock, and works out supermarket pack sizes with a
// suggestion for using the rest of the pack.
import { prisma } from "./prisma";
import { guardAvoids, mergeShopping, type Contribution, type MergedItem } from "./shopping";
import { baseFactor, extraFactor } from "./scale";
import { loadProfiles, toRuleProfile } from "./recipe-data";

type RecipeWithLines = Awaited<ReturnType<typeof loadLines>>[number];

async function loadLines(ids: string[]) {
  return prisma.recipe.findMany({ where: { id: { in: ids } }, include: { ingredients: { include: { ingredient: true } } } });
}

function contribute(r: RecipeWithLines, base: number, alex: number, sam: number): Contribution[] {
  const ctx = { title: r.title, cuisine: r.cuisine, tags: r.flavourTags, sauceFamily: r.sauceFamily };
  return r.ingredients.map((l) => ({
    ingredientId: l.ingredientId,
    slug: l.ingredient.slug,
    ctx,
    name: l.ingredient.nameEn,
    
    section: l.ingredient.section,
    unit: l.unit,
    component: l.component,
    qty: l.qty * (l.component === "both" ? base : l.component === "alex" ? alex : sam),
  }));
}

/** Pure pack maths: how many packs to buy and how much is left over. */
export function packsFor(qty: number, unit: string, packQty: number | null, packUnit: string): { packs: number; rest: number } | null {
  if (!packQty || packQty <= 0 || packUnit !== unit) return null;
  const packs = Math.max(1, Math.ceil(qty / packQty - 1e-9));
  return { packs, rest: Math.round((packs * packQty - qty) * 10) / 10 };
}

export type BuiltItem = MergedItem & { packNote: string };

/** Avoid-list guard → LOW/OUT stock → merge → packs. `leftOut` = own extras dropped for that person's avoid list. */
async function finish(recipeItems: Contribution[], excludeRecipeIds: string[]): Promise<{ items: BuiltItem[]; leftOut: string[] }> {
  const people = (await loadProfiles()).map(toRuleProfile);
  const { items, leftOut } = guardAvoids(recipeItems, people);
  const stock = await prisma.stockItem.findMany();
  const inStock = new Set(stock.filter((s) => s.status === "in").map((s) => s.ingredientId));
  // LOW / OUT stock goes on the list too (one pack each).
  const lowOut = stock.filter((s) => s.status !== "in").map((s) => s.ingredientId);
  const lowIngs = await prisma.ingredient.findMany({ where: { id: { in: lowOut } } });
  for (const i of lowIngs) {
    if (recipeItems.some((c) => c.ingredientId === i.id)) continue;
    items.push({ ingredientId: i.id, name: i.nameEn, section: i.section, unit: i.packUnit || "pack", qty: i.packQty ?? 1, component: "both" });
  }
  const merged = mergeShopping(items, inStock);
  const ings = await prisma.ingredient.findMany({ where: { id: { in: merged.map((m) => m.ingredientId) } } });
  const ingMap = new Map(ings.map((i) => [i.id, i]));
  const out: BuiltItem[] = [];
  // Packs are worked out on the combined amount (base + Alex + Sam) and shown once.
  const totals = new Map<string, number>();
  for (const m of merged) totals.set(`${m.ingredientId}|${m.unit}`, (totals.get(`${m.ingredientId}|${m.unit}`) ?? 0) + m.qty);
  const shown = new Set<string>();
  for (const m of merged) {
    const ing = ingMap.get(m.ingredientId);
    let packNote = "";
    const key = `${m.ingredientId}|${m.unit}`;
    if (shown.has(key)) {
      out.push({ ...m, packNote: "pack counted on the line above" });
      continue;
    }
    shown.add(key);
    const p = ing ? packsFor(totals.get(key) ?? m.qty, m.unit, ing.packQty, ing.packUnit) : null;
    if (ing && p) {
      packNote = `buy ${p.packs} × ${ing.packLabel || `${ing.packQty} ${ing.packUnit}`}`;
      if (p.rest > 0 && p.rest >= (ing.packQty ?? 0) * 0.25) {
        const other = await prisma.recipe.findFirst({
          where: { status: "published", id: { notIn: excludeRecipeIds }, ingredients: { some: { ingredientId: ing.id } } },
          select: { title: true },
        });
        packNote += ` · ${p.rest} ${m.unit} left over${other ? ` → use in “${other.title}”` : ""}${ing.freezable ? " (or freeze it)" : ""}`;
      }
    } else if (ing?.packLabel) {
      packNote = `usually sold as ${ing.packLabel}`;
    }
    out.push({ ...m, packNote });
  }
  return { items: out, leftOut };
}

export async function buildFromRecipes(sel: { recipeId: string; servings: number }[]) {
  const recipes = await loadLines(sel.map((s) => s.recipeId));
  const items: Contribution[] = [];
  for (const s of sel) {
    const r = recipes.find((x) => x.id === s.recipeId);
    if (!r) continue;
    const ef = extraFactor(s.servings);
    items.push(...contribute(r, baseFactor(r.servings, s.servings), ef, ef));
  }
  return finish(items, sel.map((s) => s.recipeId));
}

/**
 * Which slots + prep batches a list for `days` (0 = Monday; undefined = whole week) has to buy for: fresh slots
 * of those days; a prep batch once when one of those days eats from it or it is cooked on one of them
 * (prepDay). Leftover / freezer slots buy nothing. Pure — tested in tests/shopping-days.test.ts.
 */
export function pickPlanDays<S extends { day: number; source: string; prepBatchId?: string | null }, B extends { id?: string; prepDay?: number }>(slots: S[], batches: B[], days?: number[]): { slots: S[]; batches: B[] } {
  if (!days) return { slots: slots.filter((s) => (s.source === "fresh" || s.source === "leftover")), batches };
  const want = new Set(days);
  const chosen = slots.filter((s) => want.has(s.day));
  const used = new Set(chosen.map((s) => s.prepBatchId).filter((x): x is string => !!x));
  return { slots: chosen.filter((s) => (s.source === "fresh" || s.source === "leftover")), batches: batches.filter((b) => (b.id != null && used.has(b.id)) || (b.prepDay != null && want.has(b.prepDay))) };
}

/** Short list name part for chosen days: "Mon–Tue" / "Mon, Wed" / "" for the whole week. */
export function daysLabel(days?: number[]): string {
  if (!days || days.length === 7) return "";
  const N = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const d = [...new Set(days)].sort((a, b) => a - b);
  const run = d.every((x, i) => i === 0 || x === d[i - 1] + 1);
  return run && d.length > 2 ? `${N[d[0]]}–${N[d[d.length - 1]]}` : d.map((x) => N[x]).join(", ");
}

/** Fresh slots for both people (portion factors), prep batches once, leftover lunches bought too (cooked double the night before) — whole week or `days` only. */
export async function buildFromPlan(planId: string, days?: number[]) {
  const full = await prisma.mealPlan.findUnique({ where: { id: planId }, include: { slots: true, batches: true } });
  if (!full) throw new Error("plan not found");
  const plan = pickPlanDays(full.slots, full.batches, days);
  const profiles = await prisma.userProfile.findMany({ include: { user: { select: { slug: true } } } });
  const pfN = profiles.find((p) => p.user.slug === "alex")?.portionFactor ?? 1;
  const pfA = profiles.find((p) => p.user.slug === "sam")?.portionFactor ?? 1;
  const ids = [...new Set([...plan.slots.map((s) => s.recipeId), ...plan.batches.map((b) => b.recipeId)])];
  const recipes = await loadLines(ids);
  const items: Contribution[] = [];
  for (const s of plan.slots) {
    const r = recipes.find((x) => x.id === s.recipeId);
    if (r) items.push(...contribute(r, (pfN + pfA) / Math.max(1, r.servings), pfN, pfA));
  }
  for (const b of plan.batches) {
    const r = recipes.find((x) => x.id === b.recipeId);
    if (!r) continue;
    const perPerson = b.portions / 2;
    items.push(...contribute(r, b.portions / Math.max(1, r.servings), perPerson * pfN, perPerson * pfA));
  }
  return finish(items, ids);
}

export async function saveList(name: string, source: string, items: BuiltItem[]) {
  return prisma.shoppingList.create({
    data: {
      name,
      source,
      items: {
        create: items.map((m, k) => ({ ingredientId: m.ingredientId, name: m.name, qty: m.qty, unit: m.unit, section: m.section, forWho: m.forWho, inPantry: m.inPantry, packNote: m.packNote, avoidNote: m.avoidNote, sort: k })),
      },
    },
  });
}
