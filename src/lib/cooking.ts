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
  who: string; // alex | sam | either
  minutes: number;
  text: string;
}

export interface LaneItem {
  n: number;
  lane: "alex" | "sam";
  start: number;
  end: number;
  text: string;
}

/**
 * Two cooks, steps in recipe order. A step starts when its cook is free AND the step before it has
 * started (so order is kept but work overlaps). "either" goes to whoever is free first — the "sam" lane
 * only takes beginner-safe steps (tagged sam/either). Returns both lanes and the finish time,
 * and the minute each cook should START so both finish together.
 */
export function cookTogether(steps: TimelineStep[]): { items: LaneItem[]; total: number; alexEnd: number; samEnd: number } {
  let alexFree = 0;
  let samFree = 0;
  let prevStart = 0;
  const items: LaneItem[] = [];
  for (const s of steps) {
    const dur = Math.max(1, s.minutes);
    let lane: "alex" | "sam";
    if (s.who === "alex") lane = "alex";
    else if (s.who === "sam") lane = "sam";
    else lane = samFree <= alexFree ? "sam" : "alex";
    const free = lane === "alex" ? alexFree : samFree;
    const start = Math.max(free, prevStart);
    const end = start + dur;
    if (lane === "alex") alexFree = end;
    else samFree = end;
    prevStart = start;
    items.push({ n: s.n, lane, start, end, text: s.text });
  }
  return { items, total: Math.max(alexFree, samFree), alexEnd: alexFree, samEnd: samFree };
}
