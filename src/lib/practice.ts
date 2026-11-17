// Practice tracking: how often each recipe was cooked and the last confidence score, per user.
// A cooked dish with a `sauceLesson` also credits that Sauce School lesson (CookLog.sauceLessonSlug),
// with its own sauce rating — so a sauce learnt inside an everyday dinner counts as practised.
import { prisma } from "./prisma";

export interface Practice {
  count: number;
  /** last confidence from cooking THIS recipe; null when it was only practised as a sauce inside other dishes */
  confidence: number | null;
  last: Date | null;
  tweak: string;
  /** dish rating for a direct cook, sauce rating for a sauce credit (unrated credits are skipped) */
  lastRating: number | null;
  bestRating: number | null;
}

export interface PracticeLog {
  recipeId: string;
  confidence: number;
  rating: number;
  cookedAt: Date;
  tweak: string;
  sauceLessonSlug: string | null;
  sauceRating: number | null;
}

/** Pure: logs in cookedAt order + lesson slug → id. A sauce credit counts once for the lesson (never twice when the
 *  logged recipe IS the lesson). */
export function buildPracticeMap(logs: PracticeLog[], lessonIdBySlug: Map<string, string>): Map<string, Practice> {
  const m = new Map<string, Practice>();
  const get = (id: string) => m.get(id) ?? { count: 0, confidence: null, last: null, tweak: "", lastRating: null, bestRating: null };
  const rate = (p: Practice, n: number | null) => {
    if (n == null) return;
    p.lastRating = n;
    p.bestRating = Math.max(p.bestRating ?? 0, n);
  };
  for (const l of logs) {
    const cur = get(l.recipeId);
    cur.count++;
    cur.confidence = l.confidence;
    cur.last = l.cookedAt;
    if (l.tweak) cur.tweak = l.tweak;
    rate(cur, l.rating);
    m.set(l.recipeId, cur);
    const lessonId = l.sauceLessonSlug ? lessonIdBySlug.get(l.sauceLessonSlug) : undefined;
    if (lessonId && lessonId !== l.recipeId) {
      const s = get(lessonId);
      s.count++;
      s.last = l.cookedAt;
      rate(s, l.sauceRating);
      m.set(lessonId, s);
    }
  }
  return m;
}

export async function practiceMap(userId: string): Promise<Map<string, Practice>> {
  const logs = await prisma.cookLog.findMany({
    where: { userId },
    orderBy: { cookedAt: "asc" },
    select: { recipeId: true, confidence: true, rating: true, cookedAt: true, tweak: true, sauceLessonSlug: true, sauceRating: true },
  });
  const slugs = [...new Set(logs.map((l) => l.sauceLessonSlug).filter((s): s is string => !!s))];
  const lessons = slugs.length ? await prisma.recipe.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } }) : [];
  return buildPracticeMap(logs, new Map(lessons.map((r) => [r.slug, r.id])));
}

/** Cooked but not yet confident (<4) → "make it again". Most recent first. Sauce-only credits have no confidence of
 *  their own and are not listed. */
export function makeAgain<T extends { id: string }>(recipes: T[], pm: Map<string, Practice>): T[] {
  return recipes
    .filter((r) => {
      const p = pm.get(r.id);
      return p && p.confidence != null && p.confidence < 4;
    })
    .sort((a, b) => (pm.get(b.id)!.last?.getTime() ?? 0) - (pm.get(a.id)!.last?.getTime() ?? 0));
}
