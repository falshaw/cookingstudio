// Puts the amount into the step sentence ("add the butter" → "add the **15 g** butter") — the most common recipe
// complaint is scrolling back up for quantities. Pure; tested in tests/inline-amounts.test.ts.
// Only the step's own linked lines are used; each line is placed once, at its first mention; an ingredient that is
// not named in the text simply stays in the "Uses" line below the step.

export interface AmountLine {
  id: string;
  qty: number;
  unit: string;
  name: string;
}

export type Segment = { text: string } | { amount: string; lineId: string };

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Words to look for, most specific first: full name, name without "(…)", then its first and last word (≥ 4 letters). */
export function nameVariants(name: string): string[] {
  const base = name.replace(/\(.*?\)/g, "").trim().toLowerCase();
  const words = base.split(/\s+/).filter((w) => w.length >= 4);
  const out = [base, ...(words.length > 1 ? [words[0], words[words.length - 1]] : [])];
  return [...new Set(out.filter(Boolean))];
}

export function inlineAmounts(text: string, lines: AmountLine[], fmt: (n: number) => string): Segment[] {
  type Hit = { start: number; end: number; line: AmountLine };
  const hits: Hit[] = [];
  const taken = (s: number, e: number) => hits.some((h) => s < h.end && e > h.start);
  const seenNames = new Set<string>();
  // longest names first, so "red onion" claims its words before plain "onion" can match inside them
  for (const line of [...lines].sort((a, b) => b.name.length - a.name.length)) {
    const key = line.name.toLowerCase();
    if (seenNames.has(key)) continue; // same ingredient twice (one per person) → the "Uses" line shows both
    for (const v of nameVariants(line.name)) {
      const re = new RegExp(`\\b${escapeRe(v)}(e?s)?\\b`, "i");
      const m = re.exec(text);
      // "half the butter", "the rest of the spice", "1 tbsp oil": the full line amount would be wrong there
      const before = m ? text.slice(Math.max(0, m.index - 22), m.index).toLowerCase() : "";
      const partial = /(?:\b(?:half|third|quarter|rest|remaining|some|little|pinch|splash|dash|drizzle)\s+(?:of\s+)?(?:the\s+)?|\d[\d.,/]*\s*[a-z]{0,5}\s+)$/.test(before);
      if (m && !partial && !taken(m.index, m.index + m[0].length)) {
        hits.push({ start: m.index, end: m.index + m[0].length, line });
        seenNames.add(key);
        break;
      }
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: Segment[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start > pos) out.push({ text: text.slice(pos, h.start) });
    out.push({ amount: `${fmt(h.line.qty)} ${h.line.unit}`, lineId: h.line.id });
    out.push({ text: " " + text.slice(h.start, h.end) });
    pos = h.end;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out;
}

/**
 * All steps of a recipe in order: each line's amount appears only at the FIRST step that names it ("the kofta and
 * carrots" in a plating step must not repeat the 4 carrots from step 1). A step uses its linked lines; a step with no
 * links falls back to all lines.
 */
export function amountsForSteps(steps: { text: string; lineIds: string[] }[], all: AmountLine[], fmt: (n: number) => string): Segment[][] {
  const byId = new Map(all.map((l) => [l.id, l]));
  const placed = new Set<string>();
  return steps.map((s) => {
    const linked = s.lineIds.map((id) => byId.get(id)).filter((l): l is AmountLine => !!l);
    const pool = (linked.length ? linked : all).filter((l) => !placed.has(l.id));
    const segs = inlineAmounts(s.text, pool, fmt);
    for (const g of segs) if ("amount" in g) placed.add(g.lineId);
    return segs;
  });
}
