// Sauce features: "sauce from my fridge" matching, freezer-sauce filter, the Sauce School ladder
// (times made, ratings, next sauce in the family), Level-1 rescue tips and the single-sauce drill. Pure, tested in
// tests/sauce-features.test.ts.
import type { Practice } from "./practice";

/** Always in the kitchen — never block a sauce: water, salt, pepper, cooking oil. */
export const ALWAYS_AVAILABLE = new Set(["water", "salt", "black-pepper", "olive-oil", "sunflower-oil"]);

export interface SauceLine {
  slug: string;
  nameEn: string;
  isMeat: boolean;
  isFish: boolean;
}

export interface SauceForMatch {
  id: string;
  slug: string;
  title: string;
  level: number;
  sauceFamily: string | null;
  lines: SauceLine[];
}

export interface SauceMatch<T extends SauceForMatch = SauceForMatch> {
  sauce: T;
  missing: string[]; // English names, deduplicated
  /** the lesson cooks the sauce in the pan of a meat/fish (the protein is the carrier, not a sauce ingredient) */
  withProtein: string[];
}

/**
 * Sauces makeable from stock now (`ready`) and the ones missing exactly one ingredient (`oneShort`).
 * `inStock` = ingredient slugs with StockItem status in/low. Meat/fish lines are the dish the sauce goes over,
 * not sauce ingredients, so they never count as missing.
 */
export function matchSauces<T extends SauceForMatch>(sauces: T[], inStock: Set<string>): { ready: SauceMatch<T>[]; oneShort: SauceMatch<T>[] } {
  const ready: SauceMatch<T>[] = [];
  const oneShort: SauceMatch<T>[] = [];
  for (const s of sauces) {
    const need = s.lines.filter((l) => !l.isMeat && !l.isFish && !ALWAYS_AVAILABLE.has(l.slug));
    if (!need.length) continue;
    const missing = [...new Set(need.filter((l) => !inStock.has(l.slug)).map((l) => l.nameEn))];
    const withProtein = [...new Set(s.lines.filter((l) => l.isMeat || l.isFish).map((l) => l.nameEn))];
    if (missing.length === 0) ready.push({ sauce: s, missing, withProtein });
    else if (missing.length === 1) oneShort.push({ sauce: s, missing, withProtein });
  }
  const order = (a: SauceMatch<T>, b: SauceMatch<T>) => a.sauce.level - b.sauce.level || a.sauce.title.localeCompare(b.sauce.title);
  return { ready: ready.sort(order), oneShort: oneShort.sort(order) };
}

/** A real freezer sauce: Sauce School lesson with a family that keeps in the freezer (not rice, roasts or stocks). */
export function isFreezerSauce(r: { kind: string; sauceFamily: string | null; freezerDays: number | null }): boolean {
  return r.kind === "lesson" && !!r.sauceFamily && (r.freezerDays ?? 0) > 0;
}

/** Same rule as a Prisma `where` (status is added by the caller). */
export const FREEZER_SAUCE_WHERE = { kind: "lesson", sauceFamily: { not: null }, freezerDays: { gt: 0 } } as const;

/** Freezer batch for a household of `people`: one dinner tonight + two dinners frozen as single portions
 *  (two people: cook 6, eat 2, freeze 4). Capped at 24 portions. */
export function batchPreset(people: number): { cook: number; tonight: number } {
  const n = Math.max(1, Math.min(8, Math.round(people)));
  return { cook: 3 * n, tonight: n };
}

/** One rescue tip per Level-1 (quick) sauce. Kept in code — the seed files belong to the recipe content. */
export const RESCUE_TIPS: Record<string, { problem: string; fix: string }> = {
  "s1-pan-juice-cream": { problem: "Too thin", fix: "let it bubble 1–2 min more, stirring, until it coats the spoon" },
  "s1-mustard-cream": { problem: "Too salty", fix: "stir in a splash of cream or water" },
  "s1-lemon-butter": { problem: "Split or greasy", fix: "take the pan off the heat and whisk in a spoon of water" },
  "s1-garlic-yogurt": { problem: "Too thick", fix: "stir in a splash of water" },
  "s1-tomato-paste": { problem: "Too salty", fix: "stir in a splash of cream, yogurt or water" },
  "s1-roast-tomato-feta": { problem: "Too thin / watery", fix: "tip it into a pan and bubble 1–2 min more" },
};

export interface LadderRow<T> {
  sauce: T;
  made: number;
  lastRating: number | null;
  bestRating: number | null;
  /** made ≥ 2× with a last rating ≥ 4 → ready for the next sauce in the family */
  mastered: boolean;
}

export const MASTER_TIMES = 2;
export const MASTER_RATING = 4;

export function ladderRow<T extends { id: string }>(sauce: T, pm: Map<string, Practice>): LadderRow<T> {
  const p = pm.get(sauce.id);
  const made = p?.count ?? 0;
  const lastRating = p?.lastRating ?? null;
  return { sauce, made, lastRating, bestRating: p?.bestRating ?? null, mastered: made >= MASTER_TIMES && (lastRating ?? 0) >= MASTER_RATING };
}

/**
 * Next sauce per family: once any sauce of a family is mastered, the first not-yet-made sauce of that family
 * (lowest level, then title). `sauces` should already exclude what the viewer disliked. Map family → sauce.
 */
export function nextInFamily<T extends { id: string; title: string; level: number; sauceFamily: string | null }>(sauces: T[], pm: Map<string, Practice>): Map<string, T> {
  const out = new Map<string, T>();
  const families = new Set(sauces.map((s) => s.sauceFamily).filter((f): f is string => !!f));
  for (const f of families) {
    const list = sauces.filter((s) => s.sauceFamily === f);
    if (!list.some((s) => ladderRow(s, pm).mastered)) continue;
    const next = list.filter((s) => !pm.has(s.id)).sort((a, b) => a.level - b.level || a.title.localeCompare(b.title))[0];
    if (next) out.set(f, next);
  }
  return out;
}

/**
 * Drill: where the sauce starts. Leading steps that only cook the meat/fish (all their lines are protein, or no
 * lines and the text cooks a protein "until cooked through") are the warm-up; the drill opens on the first other step.
 */
export function drillStartIndex(steps: { text: string; lineIds: string[] }[], proteinLineIds: Set<string>): number {
  const PROTEIN_TEXT = /\b(chicken|beef|pork|lamb|steak|fish|salmon|thighs?|breasts?|mince)\b/i;
  const COOKED = /cooked through|until (it is |they are )?cooked|until done/i;
  let i = 0;
  for (; i < steps.length - 1; i++) {
    const s = steps[i];
    const onlyProtein = s.lineIds.length > 0 ? s.lineIds.every((id) => proteinLineIds.has(id)) : PROTEIN_TEXT.test(s.text) && COOKED.test(s.text);
    if (!onlyProtein) break;
  }
  return i;
}

/** Drill batch: 1 or 2 portions. */
export function drillServings(n: number | undefined): 1 | 2 {
  return n === 1 ? 1 : 2;
}
