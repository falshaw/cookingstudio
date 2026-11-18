// Macros are COMPUTED from USDA FoodData Central (SR Legacy, per 100 g) — never guessed by a model.
// Pure functions: unit-tested in tests/nutrition.test.ts.

export interface Per100 {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  satFat: number | null;
  fibre: number | null;
  sugar: number | null;
  mufa?: number | null;
  pufa?: number | null;
  epa?: number | null;
  dha?: number | null;
  ala?: number | null;
}

export interface Macros {
  kcal: number;
  protein: number;
  carbs: number;
  netCarbs: number;
  fat: number;
  satFat: number;
  fibre: number;
  sugar: number;
  /** fat quality (g): monounsaturated, polyunsaturated, omega-3 EPA, DHA, ALA */
  mufa: number;
  pufa: number;
  epa: number;
  dha: number;
  ala: number;
  /** grams of ingredients with no nutrition data (macros are a floor, not exact) */
  unknownGrams: number;
}

export const ZERO: Macros = { kcal: 0, protein: 0, carbs: 0, netCarbs: 0, fat: 0, satFat: 0, fibre: 0, sugar: 0, mufa: 0, pufa: 0, epa: 0, dha: 0, ala: 0, unknownGrams: 0 };

export interface NutLine {
  grams: number;
  ref: Per100 | null;
}

export function sumMacros(lines: NutLine[], factor = 1): Macros {
  const m = { ...ZERO };
  for (const l of lines) {
    const g = l.grams * factor;
    if (!l.ref) {
      m.unknownGrams += g;
      continue;
    }
    const k = g / 100;
    m.kcal += l.ref.kcal * k;
    m.protein += l.ref.protein * k;
    m.carbs += l.ref.carbs * k;
    m.fat += l.ref.fat * k;
    m.satFat += (l.ref.satFat ?? 0) * k;
    m.fibre += (l.ref.fibre ?? 0) * k;
    m.sugar += (l.ref.sugar ?? 0) * k;
    m.mufa += (l.ref.mufa ?? 0) * k;
    m.pufa += (l.ref.pufa ?? 0) * k;
    m.epa += (l.ref.epa ?? 0) * k;
    m.dha += (l.ref.dha ?? 0) * k;
    m.ala += (l.ref.ala ?? 0) * k;
  }
  m.netCarbs = Math.max(0, m.carbs - m.fibre);
  return m;
}

export function addMacros(a: Macros, b: Macros): Macros {
  const r = { ...ZERO };
  for (const k of Object.keys(ZERO) as (keyof Macros)[]) r[k] = a[k] + b[k];
  return r;
}

export function roundMacros(m: Macros): Macros {
  const r = { ...m };
  for (const k of Object.keys(r) as (keyof Macros)[]) r[k] = k === "epa" || k === "dha" || k === "ala" ? Math.round(r[k] * 100) / 100 : Math.round(r[k] * 10) / 10;
  return r;
}

export interface CompLine extends NutLine {
  /** null = shared base, else the user id whose own extra this line is */
  forUserId: string | null;
}

/**
 * One person's plate: their share of the shared base (base is written for `servings` portions)
 * times their portion factor, plus their own extras (written per ONE portion). `personId` null = base only.
 */
export function portionMacros(lines: CompLine[], servings: number, personId: string | null, portionFactor = 1): Macros {
  const base = sumMacros(lines.filter((l) => l.forUserId == null), portionFactor / Math.max(1, servings));
  if (!personId) return base;
  const extra = sumMacros(lines.filter((l) => l.forUserId === personId), portionFactor);
  return addMacros(base, extra);
}
