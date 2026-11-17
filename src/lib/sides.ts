// Healthy sides to round out a plate that is light on its own. A fixed list built only from ingredients the app already knows,
// so the macros come from the same USDA table as the recipes — never from a model.
// pickSides is pure: unit-tested in tests/sides.test.ts.

import { addMacros, roundMacros, sumMacros, type Macros, type Per100 } from "./nutrition";
import { matchesFood, type RuleProfile } from "./rules";

export type SideType = "green" | "salad" | "roast" | "starch";
/** cuisine groups; "any" fits everything */
export type CuisineGroup = "north" | "med" | "italian" | "asian" | "indian" | "american" | "any";

export interface SideLine {
  slug: string;
  grams: number;
  /** home measure shown to the cook */
  measure: string;
}

export interface Side {
  key: string;
  name: string;
  type: SideType;
  /** the vegetable / starch the side is about: skipped when the recipe already has it */
  main: string[];
  cuisines: CuisineGroup[];
  minutes: number;
  how: string;
  lines: SideLine[];
}

const OIL_HALF = { slug: "olive-oil", grams: 7, measure: "½ tbsp" };

export const SIDES: Side[] = [
  // ── cooked greens ──
  { key: "lemon-oregano-beans", name: "Green beans with lemon and oregano", type: "green", main: ["green-beans"], cuisines: ["med", "italian", "any"], minutes: 7,
    how: "Boil the beans in salted water for 5 minutes, drain, toss with the oil, the lemon juice and the oregano.",
    lines: [{ slug: "green-beans", grams: 150, measure: "150 g" }, OIL_HALF, { slug: "lemon", grams: 15, measure: "¼ lemon, juice" }, { slug: "oregano", grams: 0.5, measure: "½ tsp" }] },
  { key: "butter-dill-beans", name: "Buttered green beans with dill", type: "green", main: ["green-beans"], cuisines: ["north"], minutes: 7,
    how: "Boil the beans in salted water for 5 minutes, drain, toss with the butter and the dill while hot.",
    lines: [{ slug: "green-beans", grams: 150, measure: "150 g" }, { slug: "butter", grams: 7, measure: "1 tsp" }, { slug: "dill", grams: 1, measure: "1 tsp dried" }] },
  { key: "garlic-ginger-beans", name: "Garlic-ginger green beans", type: "green", main: ["green-beans"], cuisines: ["asian", "indian"], minutes: 8,
    how: "Fry the sliced garlic and grated ginger in the oil for 30 seconds, add the beans and a splash of water, lid on for 5 minutes, then the soy sauce.",
    lines: [{ slug: "green-beans", grams: 150, measure: "150 g" }, OIL_HALF, { slug: "garlic", grams: 5, measure: "1 clove, sliced thin" }, { slug: "ginger", grams: 5, measure: "1 cm, grated" }, { slug: "soy-sauce", grams: 5, measure: "1 tsp" }] },
  { key: "broccoli-parmesan", name: "Air-fryer broccoli with parmesan and lemon", type: "green", main: ["broccoli"], cuisines: ["italian", "med", "north", "american", "any"], minutes: 12,
    how: "Toss the florets in the oil, air-fry at 190 °C for 10 minutes and shake once. Grate the parmesan over and squeeze on the lemon.",
    lines: [{ slug: "broccoli", grams: 200, measure: "200 g, in florets" }, OIL_HALF, { slug: "parmesan", grams: 10, measure: "1 tbsp, grated" }, { slug: "lemon", grams: 10, measure: "a squeeze" }] },
  { key: "broccoli-soy-lime", name: "Steamed broccoli with soy and lime", type: "green", main: ["broccoli"], cuisines: ["asian", "indian"], minutes: 6,
    how: "Steam or boil the florets for 4 minutes so they stay bright green, drain, then the soy sauce, lime and chilli flakes.",
    lines: [{ slug: "broccoli", grams: 200, measure: "200 g, in florets" }, { slug: "soy-sauce", grams: 5, measure: "1 tsp" }, { slug: "lime", grams: 10, measure: "a squeeze" }, { slug: "chilli-flakes", grams: 0.5, measure: "a pinch" }] },
  { key: "brussels-balsamic", name: "Air-fryer Brussels sprouts with balsamic", type: "green", main: ["brussels-sprouts"], cuisines: ["north", "italian", "american"], minutes: 16,
    how: "Halve the sprouts, toss in the oil, air-fry at 190 °C for 14 minutes and shake once. A few drops of balsamic at the end.",
    lines: [{ slug: "brussels-sprouts", grams: 180, measure: "180 g, halved" }, OIL_HALF, { slug: "balsamic-vinegar", grams: 5, measure: "1 tsp" }] },
  // ── salads ──
  { key: "tomato-onion-salad", name: "Tomato and red onion salad", type: "salad", main: ["tomato", "cherry-tomato"], cuisines: ["med", "italian", "north", "any"], minutes: 4,
    how: "Slice the tomato, add thin onion rings, then salt, the oil, the vinegar and the oregano. Let it stand while you plate.",
    lines: [{ slug: "tomato", grams: 200, measure: "1 large" }, { slug: "red-onion", grams: 20, measure: "a few thin rings" }, OIL_HALF, { slug: "red-wine-vinegar", grams: 5, measure: "1 tsp" }, { slug: "oregano", grams: 0.5, measure: "½ tsp" }] },
  { key: "greek-salad", name: "Greek salad", type: "salad", main: ["tomato", "cherry-tomato"], cuisines: ["med"], minutes: 5,
    how: "Cut the tomato and pepper into chunks, add the onion, crumble the feta on top, then the oil and the oregano.",
    lines: [{ slug: "tomato", grams: 150, measure: "1 medium-large" }, { slug: "red-pepper", grams: 60, measure: "½ pepper" }, { slug: "red-onion", grams: 20, measure: "a few thin rings" }, { slug: "feta", grams: 30, measure: "1 slice" }, OIL_HALF, { slug: "oregano", grams: 0.5, measure: "½ tsp" }] },
  { key: "lettuce-lemon", name: "Lettuce and cherry tomatoes with lemon", type: "salad", main: ["lettuce"], cuisines: ["any", "med", "italian", "american"], minutes: 3,
    how: "Tear the lettuce, halve the tomatoes, dress with the oil, the lemon juice and a pinch of salt just before eating.",
    lines: [{ slug: "lettuce", grams: 80, measure: "2 big handfuls" }, { slug: "cherry-tomato", grams: 60, measure: "4 tomatoes" }, OIL_HALF, { slug: "lemon", grams: 10, measure: "a squeeze" }] },
  { key: "lettuce-mustard", name: "Lettuce with mustard dressing", type: "salad", main: ["lettuce"], cuisines: ["north"], minutes: 4,
    how: "Whisk the mustard, vinegar and oil with a pinch of salt in the bowl, then add the torn lettuce and turn it through.",
    lines: [{ slug: "lettuce", grams: 80, measure: "2 big handfuls" }, { slug: "dijon-mustard", grams: 5, measure: "1 tsp" }, { slug: "red-wine-vinegar", grams: 5, measure: "1 tsp" }, { slug: "olive-oil", grams: 10, measure: "2 tsp" }] },
  { key: "carrot-lemon-salad", name: "Grated carrot with lemon and parsley", type: "salad", main: ["carrot"], cuisines: ["med", "north", "any"], minutes: 5,
    how: "Grate the carrots coarsely, mix with the lemon juice, the oil, the chopped parsley and a pinch of salt.",
    lines: [{ slug: "carrot", grams: 120, measure: "1 large" }, { slug: "lemon", grams: 15, measure: "¼ lemon, juice" }, { slug: "olive-oil", grams: 5, measure: "1 tsp" }, { slug: "parsley", grams: 5, measure: "1 tbsp, chopped" }] },
  { key: "carrot-lime-salad", name: "Carrot and spring onion salad with lime", type: "salad", main: ["carrot"], cuisines: ["asian", "indian"], minutes: 5,
    how: "Grate the carrots, slice the spring onion, mix with the lime juice, the coriander and the chilli flakes.",
    lines: [{ slug: "carrot", grams: 120, measure: "1 large" }, { slug: "spring-onion", grams: 15, measure: "1 stem" }, { slug: "lime", grams: 15, measure: "½ lime, juice" }, { slug: "coriander", grams: 3, measure: "a few leaves" }, { slug: "chilli-flakes", grams: 0.5, measure: "a pinch" }] },
  { key: "carrot-pepper-slaw", name: "Crunchy carrot and pepper slaw", type: "salad", main: ["carrot", "red-pepper"], cuisines: ["american"], minutes: 6,
    how: "Grate the carrot, cut the pepper into thin strips, mix with the mustard, vinegar and oil.",
    lines: [{ slug: "carrot", grams: 100, measure: "1 medium" }, { slug: "red-pepper", grams: 60, measure: "½ pepper" }, { slug: "dijon-mustard", grams: 5, measure: "1 tsp" }, { slug: "red-wine-vinegar", grams: 5, measure: "1 tsp" }, OIL_HALF] },
  // ── roasted / soft vegetables ──
  { key: "peppers-onion", name: "Air-fryer peppers and red onion", type: "roast", main: ["red-pepper"], cuisines: ["med", "american", "any"], minutes: 14,
    how: "Cut the pepper into strips and the onion into wedges, toss with the oil and smoked paprika, air-fry at 190 °C for 12 minutes.",
    lines: [{ slug: "red-pepper", grams: 150, measure: "1 pepper" }, { slug: "red-onion", grams: 50, measure: "½ onion" }, OIL_HALF, { slug: "smoked-paprika", grams: 1, measure: "½ tsp" }] },
  { key: "cumin-carrots", name: "Roasted carrots with cumin", type: "roast", main: ["carrot"], cuisines: ["indian", "med"], minutes: 18,
    how: "Cut the carrots into sticks, toss with the oil and cumin, air-fry at 190 °C for 15 minutes. Lemon on top.",
    lines: [{ slug: "carrot", grams: 150, measure: "2 medium" }, OIL_HALF, { slug: "cumin", grams: 1, measure: "½ tsp" }, { slug: "lemon", grams: 10, measure: "a squeeze" }] },
  { key: "butter-leeks", name: "Soft leeks in butter", type: "roast", main: ["leek"], cuisines: ["north"], minutes: 12,
    how: "Slice the leek into rings, wash, cook in the butter on low heat with 2 tbsp water and the lid on for 10 minutes.",
    lines: [{ slug: "leek", grams: 150, measure: "1 leek" }, { slug: "butter", grams: 7, measure: "1 tsp" }, { slug: "thyme", grams: 0.5, measure: "a pinch" }] },
  { key: "pumpkin-thyme", name: "Roasted pumpkin with thyme", type: "roast", main: ["pumpkin"], cuisines: ["north", "med", "any"], minutes: 20,
    how: "Cut the pumpkin into 2 cm cubes, toss with the oil and thyme, air-fry at 190 °C for 18 minutes.",
    lines: [{ slug: "pumpkin", grams: 200, measure: "200 g, cubed" }, OIL_HALF, { slug: "thyme", grams: 0.5, measure: "a pinch" }] },
  // ── small starch: only when the plate still has room under the carb limit ──
  { key: "parsley-potatoes", name: "Small parsley potatoes", type: "starch", main: ["potato"], cuisines: ["north"], minutes: 18,
    how: "Boil the potatoes in salted water for 15 minutes, drain, toss with the butter and parsley. Eat them last on the plate.",
    lines: [{ slug: "potato", grams: 120, measure: "1 medium" }, { slug: "butter", grams: 5, measure: "1 tsp" }, { slug: "parsley", grams: 3, measure: "1 tsp, chopped" }] },
  { key: "lemon-potatoes", name: "Lemon-oregano potatoes, small portion", type: "starch", main: ["potato"], cuisines: ["med"], minutes: 22,
    how: "Cut the potato into wedges, toss with the oil, lemon and oregano, air-fry at 200 °C for 20 minutes. Eat them last on the plate.",
    lines: [{ slug: "potato", grams: 120, measure: "1 medium" }, OIL_HALF, { slug: "lemon", grams: 10, measure: "a squeeze" }, { slug: "oregano", grams: 0.5, measure: "½ tsp" }] },
  { key: "herb-quinoa", name: "Lemon-herb quinoa, small portion", type: "starch", main: ["quinoa"], cuisines: ["med", "indian", "asian", "any"], minutes: 15,
    how: "Rinse the quinoa, simmer in twice its volume of salted water for 12 minutes, then stir in the lemon, oil and parsley. Eat it last on the plate.",
    lines: [{ slug: "quinoa", grams: 40, measure: "3 tbsp dry" }, { slug: "lemon", grams: 10, measure: "a squeeze" }, { slug: "olive-oil", grams: 5, measure: "1 tsp" }, { slug: "parsley", grams: 3, measure: "1 tsp, chopped" }] },
];

export const SIDE_SLUGS = [...new Set(SIDES.flatMap((s) => s.lines.map((l) => l.slug)))];

/** ingredients that already make the plate starchy: no starch side then */
const STARCH_IN_RECIPE = ["potato", "quinoa", "basmati-rice", "arborio-rice", "spaghetti", "tagliatelle", "flatbread", "sourdough-bread"];

export function cuisineGroup(cuisine: string | null | undefined): CuisineGroup {
  const c = (cuisine ?? "").toLowerCase();
  if (["european", "french", "steakhouse", "basics"].includes(c)) return "north";
  if (["greek", "mediterranean", "middle eastern", "spanish"].includes(c)) return "med";
  if (c === "italian") return "italian";
  if (c === "thai") return "asian";
  if (c === "indian") return "indian";
  if (c === "american bbq") return "american";
  return "any";
}

export interface SideInput {
  recipeSlug: string;
  cuisine: string | null;
  /** slugs of every ingredient in the recipe */
  ingredientSlugs: string[];
  /** this viewer's portion of the dish */
  portion: Macros;
  profile: Pick<RuleProfile, "avoidFoods" | "maxNetCarbsPerMeal">;
  /** per-100 g data and display name per side-ingredient slug */
  refs: Map<string, { nameEn: string; ref: Per100 | null }>;
}

export interface SidePick {
  key: string;
  name: string;
  type: SideType;
  minutes: number;
  how: string;
  lines: { name: string; measure: string }[];
  macros: Macros;
  plate: Macros;
}

/** small stable hash so different recipes do not all show the same three sides */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function sideMacros(side: Side, refs: SideInput["refs"]): Macros {
  return sumMacros(side.lines.map((l) => ({ grams: l.grams, ref: refs.get(l.slug)?.ref ?? null })));
}

/** Up to three sides for this viewer: one cooked green, one salad, then a small starch if it fits the carb limit, else a roasted vegetable. */
export function pickSides(input: SideInput): SidePick[] {
  const have = new Set(input.ingredientSlugs);
  const group = cuisineGroup(input.cuisine);
  const starchy = input.ingredientSlugs.some((s) => STARCH_IN_RECIPE.includes(s));
  const limit = input.profile.maxNetCarbsPerMeal;
  const avoided = (side: Side) =>
    side.lines.some((l) => input.profile.avoidFoods.some((t) => matchesFood(l.slug, input.refs.get(l.slug)?.nameEn ?? l.slug, t)));
  const scored = SIDES.filter((s) => !s.main.some((m) => have.has(m)))
    .filter((s) => !avoided(s))
    .filter((s) => !(s.type === "starch" && starchy))
    .map((s) => {
      const macros = sideMacros(s, input.refs);
      const fit = s.cuisines.includes(group) ? 2 : s.cuisines.includes("any") ? 1 : 0;
      return { s, macros, fit, tie: hash(`${input.recipeSlug}:${s.key}`) };
    })
    .filter((x) => limit == null || input.portion.netCarbs + x.macros.netCarbs <= limit)
    .sort((a, b) => b.fit - a.fit || a.tie - b.tie);
  const matching = (t: SideType) => scored.find((x) => x.s.type === t && x.fit > 0);
  const best = (t: SideType) => matching(t) ?? scored.find((x) => x.s.type === t);
  // a vegetable that suits the cuisine beats a starch that does not (no parsley potatoes with a curry)
  const third = matching("starch") ?? matching("roast") ?? best("starch") ?? best("roast");
  const picks = [best("green"), best("salad"), third].filter((x): x is NonNullable<typeof x> => !!x);
  return picks.map(({ s, macros }) => ({
    key: s.key,
    name: s.name,
    type: s.type,
    minutes: s.minutes,
    how: s.how,
    lines: s.lines.map((l) => ({ name: input.refs.get(l.slug)?.nameEn ?? l.slug, measure: l.measure })),
    macros: roundMacros(macros),
    plate: roundMacros(addMacros(input.portion, macros)),
  }));
}
