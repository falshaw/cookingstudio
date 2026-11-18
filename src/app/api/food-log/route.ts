import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withScoped, zId } from "@/lib/api";
import { dayTotals, editedEntry, macrosForGrams, MEALS } from "@/lib/food-log";
import { recipeEntryMacros } from "@/lib/plan-log";
import { isRealDay } from "@/lib/utils";

// Optional food log. Macros are snapshotted from the USDA table (recipe portion, ingredient grams, or a
// NutritionRef row by grams). Stored unrounded (Float columns); the UI rounds for display.
const Body = z.object({
  date: z.string().refine(isRealDay, "invalid date"),
  meal: z.enum(MEALS),
  recipeId: zId.optional(),
  portions: z.number().min(0.25).max(6).default(1),
  ingredientId: zId.optional(),
  /** USDA SR Legacy row picked in the "by grams" search */
  fdcId: z.number().int().positive().optional(),
  grams: z.number().min(1).max(3000).optional(),
  /** Estimate: free label + macros for food with no recipe/USDA row ("veg lasagne ~300 g"). All five or none. */
  label: z.string().trim().min(1).max(120).optional(),
  kcal: z.number().min(0).max(5000).optional(),
  protein: z.number().min(0).max(500).optional(),
  netCarbs: z.number().min(0).max(1000).optional(),
  fat: z.number().min(0).max(500).optional(),
});

const MAX_RANGE_DAYS = 62;

// My entries between two days (inclusive), oldest first, with day totals. For API keys too (food-log:read).
export async function GET(req: Request) {
  const r = await withScoped(req, null, ["food-log:read", "food-log:write"]);
  if (r.error) return r.error;
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? from;
  if (!isRealDay(from) || !isRealDay(to)) return bad("from/to must be YYYY-MM-DD");
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (b < a) return bad("to is before from");
  if ((b.getTime() - a.getTime()) / 86_400_000 >= MAX_RANGE_DAYS) return bad(`at most ${MAX_RANGE_DAYS} days`);
  const rows = await prisma.foodLog.findMany({
    where: { userId: r.user.id, date: { gte: a, lte: b } },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    select: { id: true, date: true, meal: true, label: true, portions: true, kcal: true, protein: true, netCarbs: true, fat: true },
  });
  const entries = rows.map((e) => ({ ...e, date: e.date.toISOString().slice(0, 10) }));
  return ok({ entries, days: dayTotals(entries) });
}

export async function POST(req: Request) {
  const r = await withScoped(req, Body, "food-log:write");
  if (r.error) return r.error;
  const b = r.body;
  let label = "";
  let m;
  if (b.recipeId) {
    const rm = await recipeEntryMacros(b.recipeId, b.portions, r.user.id);
    if (!rm) return bad("recipe not found", 404);
    m = { kcal: rm.kcal, protein: rm.protein, netCarbs: rm.netCarbs, fat: rm.fat };
    label = `${rm.title}${b.portions !== 1 ? ` × ${b.portions}` : ""}`;
  } else if (b.fdcId && b.grams) {
    const ref = await prisma.nutritionRef.findUnique({ where: { fdcId: b.fdcId } });
    if (!ref) return bad("USDA food not found", 404);
    m = macrosForGrams(ref, b.grams);
    label = `${ref.name} ${b.grams} g`;
  } else if (b.ingredientId && b.grams) {
    const ing = await prisma.ingredient.findUnique({ where: { id: b.ingredientId } });
    if (!ing) return bad("ingredient not found", 404);
    const ref = ing.fdcId ? await prisma.nutritionRef.findUnique({ where: { fdcId: ing.fdcId } }) : null;
    if (!ref) return bad("no USDA nutrition data for this ingredient", 422);
    m = macrosForGrams(ref, b.grams);
    label = `${ing.nameEn} ${b.grams} g`;
  } else if (b.label != null && b.kcal != null && b.protein != null && b.netCarbs != null && b.fat != null) {
    m = { kcal: b.kcal, protein: b.protein, netCarbs: b.netCarbs, fat: b.fat };
    label = b.label;
  } else return bad("pick a recipe, an ingredient + grams, or give label + kcal + protein + netCarbs + fat");
  await prisma.foodLog.create({ data: { userId: r.user.id, date: new Date(`${b.date}T00:00:00Z`), meal: b.meal, recipeId: b.recipeId ?? null, label, portions: b.recipeId ? b.portions : 1, kcal: m.kcal, protein: m.protein, netCarbs: m.netCarbs, fat: m.fat } });
  return ok();
}

export async function DELETE(req: Request) {
  const r = await withScoped(req, z.object({ id: zId }), "food-log:write");
  if (r.error) return r.error;
  await prisma.foodLog.deleteMany({ where: { id: r.body.id, userId: r.user.id } });
  return ok();
}

// Edit one of MY entries: meal, day, portions (macros scale with them) or the label. Someone else's entry = 404.
const Patch = z
  .object({
    id: zId,
    meal: z.enum(MEALS).optional(),
    date: z.string().refine(isRealDay, "invalid date").optional(),
    portions: z.number().min(0.25).max(6).optional(),
    label: z.string().trim().min(1).max(120).optional(),
  })
  .refine((b) => b.meal != null || b.date != null || b.portions != null || b.label != null, "nothing to change");

export async function PATCH(req: Request) {
  const r = await withScoped(req, Patch, "food-log:write");
  if (r.error) return r.error;
  const { id, ...patch } = r.body;
  const e = await prisma.foodLog.findFirst({ where: { id, userId: r.user.id } });
  if (!e) return bad("entry not found", 404);
  const data = editedEntry(e, patch);
  if (!Object.keys(data).length) return ok({ ok: true, changed: false });
  // updateMany keeps the owner in the WHERE, so the write itself can never touch another person's row
  await prisma.foodLog.updateMany({ where: { id: e.id, userId: r.user.id }, data });
  return ok({ ok: true, changed: true });
}
