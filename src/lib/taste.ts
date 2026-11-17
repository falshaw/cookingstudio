// Per-user taste profile, computed in CODE from favourites, ratings, cook counts, confidence,
// rejections and tweak notes — no model involved. Pure core (computeTaste) is unit-tested.
import { prisma } from "./prisma";

export interface TasteSignal {
  cuisine: string;
  protein: string;
  sauceFamily: string | null;
  flavourTags: string[];
  techniques: string[];
  spiceLevel: number;
  favourite: boolean;
  ratings: number[]; // 1-5 per cook
  rejected: boolean;
  tweaks: string[];
}

export interface Taste {
  cuisines: [string, number][];
  proteins: [string, number][];
  sauces: [string, number][];
  techniques: [string, number][];
  flavours: [string, number][];
  spice: number; // 0-3, weighted average
  dislikes: string[];
  tweakWords: string[];
}

function bump(m: Map<string, number>, k: string, w: number) {
  const key = k.trim().toLowerCase();
  if (!key) return;
  m.set(key, (m.get(key) ?? 0) + w);
}

const top = (m: Map<string, number>, n = 6): [string, number][] =>
  [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => [k, Math.round(v * 10) / 10]);

/** Weight: favourite +3, each cook +1, rating centred on 3 (±1 per star), rejected −4. */
export function signalWeight(s: TasteSignal): number {
  let w = s.favourite ? 3 : 0;
  w += s.ratings.length;
  w += s.ratings.reduce((a, r) => a + (r - 3), 0);
  if (s.rejected) w -= 4;
  return w;
}

export function computeTaste(signals: TasteSignal[]): Taste {
  const c = new Map<string, number>(), p = new Map<string, number>(), sa = new Map<string, number>(), te = new Map<string, number>(), fl = new Map<string, number>();
  let spiceSum = 0, spiceW = 0;
  const dislikes = new Set<string>();
  const tweakWords = new Map<string, number>();
  for (const s of signals) {
    const w = signalWeight(s);
    if (w === 0) continue;
    bump(c, s.cuisine, w);
    bump(p, s.protein, w);
    if (s.sauceFamily) bump(sa, s.sauceFamily, w);
    s.techniques.forEach((t) => bump(te, t, w));
    s.flavourTags.forEach((t) => bump(fl, t, w));
    if (w > 0) {
      spiceSum += s.spiceLevel * w;
      spiceW += w;
    }
    if (w < 0) {
      if (s.protein) dislikes.add(s.protein.toLowerCase());
      s.flavourTags.forEach((t) => dislikes.add(t.toLowerCase()));
    }
    for (const t of s.tweaks) for (const word of t.toLowerCase().match(/\b(less|more|no|extra)\s+\w+/g) ?? []) tweakWords.set(word, (tweakWords.get(word) ?? 0) + 1);
  }
  return {
    cuisines: top(c),
    proteins: top(p),
    sauces: top(sa),
    techniques: top(te),
    flavours: top(fl, 8),
    spice: spiceW ? Math.round((spiceSum / spiceW) * 10) / 10 : 0,
    dislikes: [...dislikes].filter((d) => !(top(c, 99).some(([k]) => k === d))).slice(0, 10),
    tweakWords: [...tweakWords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k),
  };
}

export async function tasteFor(userId: string): Promise<Taste & { overrides: { likes: string[]; dislikes: string[] } }> {
  const [favs, cooks, rejected, profile, dislikes] = await Promise.all([
    prisma.favourite.findMany({ where: { userId }, select: { recipeId: true } }),
    prisma.cookLog.findMany({ where: { userId }, select: { recipeId: true, rating: true, tweak: true } }),
    prisma.recipe.findMany({ where: { status: "rejected" }, select: { id: true } }),
    prisma.userProfile.findUnique({ where: { userId }, select: { tasteOverrides: true } }),
    prisma.dislike.findMany({ where: { userId }, select: { recipeId: true, ingredient: { select: { nameEn: true } } } }),
  ]);
  const dislikedIds = dislikes.map((d) => d.recipeId).filter((x): x is string => !!x);
  const ids = [...new Set([...favs.map((f) => f.recipeId), ...cooks.map((c) => c.recipeId), ...rejected.map((r) => r.id), ...dislikedIds])];
  const recipes = await prisma.recipe.findMany({ where: { id: { in: ids } }, include: { steps: { select: { technique: true } } } });
  const fav = new Set(favs.map((f) => f.recipeId));
  const rej = new Set([...rejected.map((r) => r.id), ...dislikedIds]); // 👎 counts like a rejection for this person
  const signals: TasteSignal[] = recipes.map((r) => ({
    cuisine: r.cuisine,
    protein: r.protein,
    sauceFamily: r.sauceFamily,
    flavourTags: r.flavourTags,
    techniques: r.steps.map((s) => s.technique).filter((t): t is string => !!t),
    spiceLevel: r.spiceLevel,
    favourite: fav.has(r.id),
    ratings: cooks.filter((c) => c.recipeId === r.id).map((c) => c.rating),
    rejected: rej.has(r.id),
    tweaks: cooks.filter((c) => c.recipeId === r.id && c.tweak).map((c) => c.tweak),
  }));
  const o = (profile?.tasteOverrides ?? {}) as { likes?: string[]; dislikes?: string[] };
  const t = computeTaste(signals);
  const ingDislikes = dislikes.map((d) => d.ingredient?.nameEn.toLowerCase()).filter((x): x is string => !!x);
  return { ...t, dislikes: [...new Set([...ingDislikes, ...t.dislikes])], overrides: { likes: o.likes ?? [], dislikes: o.dislikes ?? [] } };
}
