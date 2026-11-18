// Pure cooking helpers: timer detection from step text and the cook-together timeline.

export interface DetectedTimer {
  label: string;
  seconds: number;
}

const VERBS = "simmer|boil|bake|roast|rest|cook|fry|sear|reduce|soak|marinate|chill|steam|grill|poach|stand|leave|wait|sauté|saute|brown|toast|caramelise|caramelize|whisk|stir|braise";

/**
 * Finds "simmer 10 min", "bake for 25–30 minutes", "rest 5 minutes", "1 hour" in a step.
 * A range uses its upper bound (the cue tells you when to stop early).
 */
export function detectTimers(text: string): DetectedTimer[] {
  const out: DetectedTimer[] = [];
  const re = new RegExp(
    `(?:(${VERBS})\\w*[^.;,]{0,40}?)?(\\d+(?:[.,]\\d+)?)(?:\\s*(?:-|–|to)\\s*(\\d+(?:[.,]\\d+)?))?\\s*(hours?|hrs?|h|minutes?|mins?|seconds?|secs?)\\b`,
    "gi",
  );
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const verb = m[1];
    const hi = parseFloat((m[3] ?? m[2]).replace(",", "."));
    const unit = m[4].toLowerCase();
    const mult = unit.startsWith("h") ? 3600 : unit.startsWith("s") ? 1 : 60;
    const seconds = Math.round(hi * mult);
    if (seconds < 20 || seconds > 8 * 3600) continue;
    const label = verb ? `${verb[0].toUpperCase()}${verb.slice(1).toLowerCase()} ${fmtSeconds(seconds)}` : fmtSeconds(seconds);
    if (!out.some((t) => t.seconds === seconds)) out.push({ label, seconds });
  }
  return out;
}

export function fmtSeconds(s: number): string {
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m} min ${r} s` : `${m} min`;
  }
  return `${s} s`;
}

export function clock(s: number): string {
  const neg = s < 0;
  const a = Math.abs(Math.round(s));
  const h = Math.floor(a / 3600);
  const m = Math.floor((a % 3600) / 60);
  const sec = a % 60;
  const body = h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
  return neg ? `-${body}` : body;
}

export interface TimelineStep {
  n: number;
  /** skilled = knives, hot fat, searing, sauces · beginner = beginner-safe · either */
  skill: string;
  minutes: number;
  text: string;
}

export interface Cook {
  id: string;
  name: string;
  skill: "skilled" | "beginner";
}

export interface LaneItem {
  n: number;
  /** id of the cook doing it */
  lane: string;
  start: number;
  end: number;
  text: string;
}

/**
 * N cooks, steps in recipe order. A step starts when its cook is free AND the step before it has started
 * (so order is kept but work overlaps). Who may take a step:
 * - "skilled" → skilled cooks only (everyone when nobody is skilled — someone has to do it);
 * - "beginner" → beginner cooks (everyone when there is no beginner);
 * - "either" → anyone.
 * Among those, the cook who is free first gets it; on a tie a beginner goes first (keeps the skilled cooks
 * free for the hard steps), then household order. With one skilled and one beginner cook this is the old
 * two-lane split. Returns every step's lane, the finish time and when each cook is done.
 */
export function cookTogether(steps: TimelineStep[], cooks: Cook[]): { items: LaneItem[]; total: number; ends: Record<string, number> } {
  const free = new Map(cooks.map((c) => [c.id, 0]));
  let prevStart = 0;
  const items: LaneItem[] = [];
  if (!cooks.length) return { items, total: 0, ends: {} };
  const skilled = cooks.filter((c) => c.skill === "skilled");
  const beginners = cooks.filter((c) => c.skill === "beginner");
  for (const s of steps) {
    const dur = Math.max(1, s.minutes);
    let pool = cooks;
    if (s.skill === "skilled" && skilled.length) pool = skilled;
    else if (s.skill === "beginner" && beginners.length) pool = beginners;
    let cook = pool[0];
    for (const c of pool) {
      const a = free.get(c.id)!;
      const b = free.get(cook.id)!;
      if (a < b || (a === b && c.skill === "beginner" && cook.skill !== "beginner")) cook = c;
    }
    const start = Math.max(free.get(cook.id)!, prevStart);
    const end = start + dur;
    free.set(cook.id, end);
    prevStart = start;
    items.push({ n: s.n, lane: cook.id, start, end, text: s.text });
  }
  const ends = Object.fromEntries(free);
  return { items, total: Math.max(0, ...free.values()), ends };
}
