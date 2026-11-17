/** Tailwind-friendly className joiner. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

/** Round a quantity for display: 0.25 steps under 10, whole numbers above. */
export function fmtQty(n: number): string {
  if (!isFinite(n)) return "";
  if (n >= 100) return String(Math.round(n / 5) * 5);
  if (n >= 10) return String(Math.round(n));
  const r = Math.round(n * 4) / 4;
  return String(r);
}

export function fmtMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Monday 00:00 UTC of the week that contains `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow);
  return x;
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Current time in ms. A function so server components read the clock through one place. */
export function serverNow(): number {
  return Date.now();
}

/** The household's IANA time zone (APP_TIMEZONE, e.g. "America/Chicago"); invalid or unset = UTC. */
export function appTimeZone(raw: string | undefined = process.env.APP_TIMEZONE): string {
  const tz = (raw ?? "").trim();
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/** Calendar day (YYYY-MM-DD) in the household's time zone — the "today" the food log and stock dates use. */
export function localDay(d: Date = new Date(serverNow()), tz = appTimeZone()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** YYYY-MM-DD plus n days (calendar arithmetic on UTC midnight, no DST drift). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/** True for a real calendar day ("2026-02-31" is not — Date would roll it over to March). */
export function isRealDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && isoDate(new Date(`${s}T00:00:00Z`)) === s;
}
