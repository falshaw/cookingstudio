// Match an ingredient to a USDA SR Legacy row by text. The model only ever supplies a SEARCH TERM;
// the numbers always come from the USDA table.
import { prisma } from "./prisma";

export function scoreName(name: string, tokens: string[]): number {
  const n = name.toLowerCase();
  let s = 0;
  for (const t of tokens) if (n.includes(t)) s += 10;
  if (/\braw\b/.test(n)) s += 3;
  if (/\b(babyfood|infant|fast foods|restaurant|frozen dinner|snack)\b/.test(n)) s -= 15;
  s -= n.length / 40; // prefer the plain, short entry
  return s;
}

export async function findNutrition(term: string): Promise<{ fdcId: number; name: string } | null> {
  const tokens = term
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3);
  if (!tokens.length) return null;
  const rows = await prisma.nutritionRef.findMany({
    where: { name: { contains: tokens[0], mode: "insensitive" } },
    select: { fdcId: true, name: true },
    take: 400,
  });
  let best: { fdcId: number; name: string; s: number } | null = null;
  for (const r of rows) {
    const s = scoreName(r.name, tokens);
    if (!best || s > best.s) best = { ...r, s };
  }
  return best && best.s >= tokens.length * 10 - 5 ? { fdcId: best.fdcId, name: best.name } : null;
}

export interface NutritionHit { fdcId: number; name: string; kcal: number; protein: number; carbs: number; fat: number; fibre: number | null }

/** Food-log search: USDA rows whose name holds every word (≥2 letters), best plain match first. */
export function nutritionTokens(q: string): string[] {
  return q.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 2).slice(0, 5);
}

export async function searchNutrition(q: string, take = 15): Promise<NutritionHit[]> {
  const tokens = nutritionTokens(q);
  if (!tokens.length) return [];
  const rows = await prisma.nutritionRef.findMany({
    where: { AND: tokens.map((t) => ({ name: { contains: t, mode: "insensitive" as const } })) },
    select: { fdcId: true, name: true, kcal: true, protein: true, carbs: true, fat: true, fibre: true },
    take: 400,
  });
  return rows
    .map((r) => ({ r, s: scoreName(r.name, tokens) }))
    .sort((a, b) => b.s - a.s || a.r.name.localeCompare(b.r.name))
    .slice(0, take)
    .map(({ r }) => r);
}
