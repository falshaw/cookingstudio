// Meal score 0–100, rule-based in code from USDA-computed numbers for ONE person's portion.
// It rates how a plate fits everyday healthy-eating patterns (protein, fibre, carbs/GL, sugar,
// fat quality). General guidance only — not a medical score.
import type { Macros } from "./nutrition";

export interface ScorePart {
  key: "protein" | "fibre" | "carbs" | "sugar" | "fat";
  label: string;
  points: number;
  max: number;
  note: string;
}

export interface MealScore {
  score: number;
  parts: ScorePart[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/** gl = glycemic load of the portion's GI-listed foods (null = none listed / unknown). */
export function mealScore(m: Macros, gl: number | null): MealScore {
  const parts: ScorePart[] = [];
  // Protein: 25 g per meal earns the full 25 points (linear below).
  parts.push({ key: "protein", label: "Protein", max: 25, points: Math.round(Math.min(25, (m.protein / 25) * 25)), note: `${r1(m.protein)} g (25 g = full marks)` });
  // Fibre: 8 g per meal (≈ a third of a 25 g/day reference) earns 20.
  parts.push({ key: "fibre", label: "Fibre", max: 20, points: Math.round(Math.min(20, (m.fibre / 8) * 20)), note: `${r1(m.fibre)} g (8 g = full marks)` });
  // Carbs: by net carbs, adjusted by glycemic load when it is known.
  let carbs = m.netCarbs <= 20 ? 20 : m.netCarbs <= 30 ? 15 : m.netCarbs <= 45 ? 8 : 0;
  let glNote = "no GI-listed carbs";
  if (gl != null && gl > 0) {
    const pen = gl <= 10 ? 0 : gl < 20 ? 3 : 8;
    carbs = Math.max(0, carbs - pen);
    glNote = `GL ${Math.round(gl)} (${gl <= 10 ? "low" : gl < 20 ? "medium" : "high"})`;
  }
  parts.push({ key: "carbs", label: "Carbs & glycemic load", max: 20, points: carbs, note: `${r1(m.netCarbs)} g net carbs · ${glNote}` });
  // Sugar: total sugars (natural + added — the USDA data does not split them).
  const sugar = m.sugar <= 5 ? 15 : m.sugar <= 10 ? 10 : m.sugar <= 20 ? 5 : 0;
  parts.push({ key: "sugar", label: "Sugar", max: 15, points: sugar, note: `${r1(m.sugar)} g total sugars` });
  // Fat quality: unsaturated vs saturated. Lean plates (<3 g fat) get full marks.
  let fat = 20;
  let fatNote = `${r1(m.fat)} g fat — lean`;
  if (m.fat >= 3) {
    const unsat = m.mufa + m.pufa;
    const ratio = m.satFat > 0 ? unsat / m.satFat : 9;
    fat = ratio >= 2 ? 20 : ratio >= 1 ? 12 : ratio >= 0.5 ? 6 : 0;
    fatNote = `${r1(unsat)} g unsaturated vs ${r1(m.satFat)} g saturated (ratio ${r1(ratio)})`;
  }
  parts.push({ key: "fat", label: "Fat quality", max: 20, points: fat, note: fatNote });
  return { score: parts.reduce((a, p) => a + p.points, 0), parts };
}

export const scoreTone = (s: number) => (s >= 75 ? "olive" : s >= 55 ? "gold" : "red") as "olive" | "gold" | "red";
