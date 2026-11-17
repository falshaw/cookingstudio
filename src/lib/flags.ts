// Code-side ingredient flags. OR-ed with anything a model claims, so a model that forgets to mark
// bacon as meat cannot slip it into a vegetarian plate. Pure — tested in tests/rules.test.ts.

const MEAT = /\b(beef|steak|ribeye|sirloin|fillet steak|veal|pork|bacon|pancetta|guanciale|ham|prosciutto|sausage|chorizo|salami|lamb|mutton|goat|chicken|turkey|duck|mince|minced meat|meatball|gelatin|lard)\b/i;
const FISH = /\b(fish|salmon|tuna|cod|sea ?bass|sea ?bream|bream|mackerel|sardine|sardines|anchov(y|ies)|trout|herring|prawn|prawns|shrimp|squid|calamari|octopus|mussel|mussels|clam|crab|lobster|fish sauce|halibut|haddock|swordfish|lavraki|tsipoura)\b/i;
const OMEGA3 = /\b(salmon|mackerel|sardine|sardines|anchov(y|ies)|trout|herring|tuna steak)\b/i;
const ALCOHOL = /\b(wine|beer|brandy|cognac|rum|vodka|whisk(e)?y|ouzo|grappa|sherry(?! vinegar)|port wine|marsala|vermouth|liqueur|sake|mirin|cider(?! vinegar))\b/i;
const SUGAR = /\b(sugar|honey|syrup|molasses|treacle|agave|jam|ketchup|caramel|condensed milk|chocolate spread)\b/i;
const SUGAR_OK = /\b(sugar[- ]free|no sugar|sugar snap)\b/i;
const REFINED = /\b(white rice|basmati|jasmine rice|arborio|risotto rice|rice(?! vinegar)|spaghetti|pasta|penne|linguine|tagliatelle|macaroni|orzo|noodles|white bread|bread|baguette|pitta|pita|breadcrumbs|couscous|flour tortilla)\b/i;
const NOT_REFINED = /\b(cauliflower rice|brown rice|wholemeal|whole ?wheat|courgette noodles|zoodles|rice vinegar|konjac)\b/i;

export interface Flags {
  isMeat: boolean;
  isFish: boolean;
  isOmega3: boolean;
  isAlcohol: boolean;
  isAddedSugar: boolean;
  isRefinedStarch: boolean;
}

export function inferFlags(nameEn: string): Flags {
  const n = nameEn.toLowerCase();
  // stock cubes/broth: chicken stock is NOT vegetarian; vegetable stock is.
  const isFish = FISH.test(n);
  const isMeat = !isFish && MEAT.test(n) && !/\bvegetable\b|\bveg\b|\bmushroom\b/.test(n);
  return {
    isMeat,
    isFish,
    isOmega3: OMEGA3.test(n),
    isAlcohol: ALCOHOL.test(n) && !/\bvinegar\b/.test(n),
    isAddedSugar: SUGAR.test(n) && !SUGAR_OK.test(n),
    isRefinedStarch: REFINED.test(n) && !NOT_REFINED.test(n),
  };
}

export function mergeFlags(a: Partial<Flags>, b: Flags): Flags {
  return {
    isMeat: !!a.isMeat || b.isMeat,
    isFish: !!a.isFish || b.isFish,
    isOmega3: !!a.isOmega3 || b.isOmega3,
    isAlcohol: !!a.isAlcohol || b.isAlcohol,
    isAddedSugar: !!a.isAddedSugar || b.isAddedSugar,
    isRefinedStarch: !!a.isRefinedStarch || b.isRefinedStarch,
  };
}
