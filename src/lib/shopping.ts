// Shopping-list merge: quantities summed per ingredient + unit + who it is for, grouped by
// supermarket section. Pure — unit-tested in tests/shopping.test.ts.
import { avoidTermFor, type RecipeContext, type RuleProfile } from "./rules";

export const SECTIONS = [
  { key: "produce", label: "Fruit & veg" },
  { key: "herbs", label: "Fresh herbs" },
  { key: "meat", label: "Meat counter" },
  { key: "fish", label: "Fish counter" },
  { key: "dairy", label: "Dairy & eggs" },
  { key: "cheese", label: "Cheese & deli" },
  { key: "bakery", label: "Bread" },
  { key: "pantry", label: "Pantry (rice, pasta, tins)" },
  { key: "oils", label: "Oil, vinegar & sauces" },
  { key: "spices", label: "Spices & stock" },
  { key: "frozen", label: "Frozen" },
  { key: "other", label: "Other" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

export function sectionOrder(key: string): number {
  const i = SECTIONS.findIndex((s) => s.key === key);
  return i < 0 ? SECTIONS.length : i;
}

export interface Contribution {
  ingredientId: string;
  name: string;
  
  section: string;
  qty: number;
  unit: string;
  component: string; // both | alex | sam
  /** ingredient slug + recipe context — set on recipe lines so the avoid-list guard can check them */
  slug?: string;
  ctx?: RecipeContext;
  /** names of people whose avoid list has this shared line (set by guardAvoids) */
  avoidBy?: string[];
}

export interface MergedItem {
  ingredientId: string;
  name: string;
  
  section: string;
  qty: number;
  unit: string;
  forWho: "base" | "alex" | "sam";
  inPantry: boolean;
  /** "Alex avoids" — a shared item on someone's avoid list ("" = none) */
  avoidNote: string;
}

export function avoidLabel(names: string[]): string {
  return names.length ? `${names.join(" & ")} ${names.length > 1 ? "avoid" : "avoids"}` : "";
}

/**
 * Never-list guard (same matcher as the rule engine): a person's OWN extra (alex/sam line) on
 * their avoid list is left out; a shared line on someone's avoid list stays, tagged with who avoids it.
 */
export function guardAvoids(items: Contribution[], people: RuleProfile[]): { items: Contribution[]; leftOut: string[] } {
  const kept: Contribution[] = [];
  const left = new Set<string>();
  for (const c of items) {
    if (!c.slug) {
      kept.push(c);
      continue;
    }
    const line = { slug: c.slug, nameEn: c.name };
    const who = c.component === "both" ? people : people.filter((p) => p.slug === c.component);
    const by = who.filter((p) => avoidTermFor(p, line, c.ctx)).map((p) => p.name);
    if (!by.length) kept.push(c);
    else if (c.component === "both") kept.push({ ...c, avoidBy: by });
    else left.add(`${c.name.replace(/\s*\(.*?\)/g, "")} (${avoidLabel(by)})`);
  }
  return { items: kept, leftOut: [...left] };
}

export function forWhoOf(component: string): MergedItem["forWho"] {
  return component === "alex" ? "alex" : component === "sam" ? "sam" : "base";
}

/** Units that should round up to a whole number when buying. */
const COUNT_UNITS = new Set(["pc", "clove", "cube", "tin", "can", "bunch", "sprig", "leaf", "slice"]);

export function roundForShop(qty: number, unit: string): number {
  if (COUNT_UNITS.has(unit)) return Math.ceil(qty - 1e-9);
  if (unit === "g" || unit === "ml") return Math.ceil(qty / 5) * 5;
  return Math.round(qty * 4) / 4;
}

export function mergeShopping(items: Contribution[], pantry: Set<string> = new Set()): MergedItem[] {
  const map = new Map<string, MergedItem>();
  const avoid = new Map<string, Set<string>>();
  for (const c of items) {
    if (!(c.qty > 0)) continue;
    const forWho = forWhoOf(c.component);
    const key = `${c.ingredientId}|${c.unit}|${forWho}`;
    if (c.avoidBy?.length) avoid.set(key, new Set([...(avoid.get(key) ?? []), ...c.avoidBy]));
    const cur = map.get(key);
    if (cur) cur.qty += c.qty;
    else
      map.set(key, {
        ingredientId: c.ingredientId,
        name: c.name,
        
        section: c.section,
        qty: c.qty,
        unit: c.unit,
        forWho,
        inPantry: pantry.has(c.ingredientId),
        avoidNote: "",
      });
  }
  return [...map.entries()]
    .map(([key, m]) => ({ ...m, qty: roundForShop(m.qty, m.unit), avoidNote: avoidLabel([...(avoid.get(key) ?? [])].sort()) }))
    .sort(
      (a, b) =>
        sectionOrder(a.section) - sectionOrder(b.section) ||
        a.name.localeCompare(b.name) ||
        a.forWho.localeCompare(b.forWho),
    );
}

export interface ShareItem { name: string; qty: number; unit: string; section: string; forWho: string; inPantry: boolean; packNote: string; checked: boolean; avoidNote?: string }

/** Plain WhatsApp text of a list: still-to-buy items by aisle (pantry items left out when hidden), amount, pack. */
export function whatsappText(name: string, items: ShareItem[], opts: { hidePantry: boolean; fmt: (n: number) => string }): string {
  const todo = items.filter((i) => !i.checked && !(opts.hidePantry && i.inPantry));
  const lines = [`*${name}*`];
  for (const sec of [...new Set(todo.map((i) => i.section))].sort((a, b) => sectionOrder(a) - sectionOrder(b))) {
    const s = SECTIONS.find((x) => x.key === sec);
    lines.push("", `*${s ? s.label : sec}*`);
    for (const i of todo.filter((x) => x.section === sec).sort((a, b) => a.name.localeCompare(b.name))) {
      const who = i.forWho === "alex" ? " [Alex]" : i.forWho === "sam" ? " [Sam]" : "";
      const pack = i.packNote.split(" · ")[0];
      lines.push(`• ${i.name}${who} — ${opts.fmt(i.qty)} ${i.unit}${pack ? ` · ${pack}` : ""}${i.avoidNote ? ` ⚠ ${i.avoidNote}` : ""}`.trimEnd());
    }
  }
  if (!todo.length) lines.push("", "Everything is ticked.");
  return lines.join("\n");
}
