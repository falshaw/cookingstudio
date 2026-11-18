// Household model. Every user of the instance is one household member with their own profile.
// Recipe lines are either shared (forUserId null, written for recipe.servings) or one person's own extra
// (forUserId = that user, written for ONE portion). Cook-along steps carry a skill, and cooks are matched
// to steps by their profile's cookingSkill. Pure helpers — unit-tested in tests/household.test.ts.

export type Skill = "skilled" | "beginner" | "either";
export type CookSkill = "skilled" | "beginner";

export interface Member {
  id: string;
  slug: string;
  name: string;
  portionFactor: number;
  cookingSkill: CookSkill;
}

/** Household order everywhere (lists, lanes, tables): who was created first, then slug. */
export const HOUSEHOLD_ORDER = [{ createdAt: "asc" as const }, { slug: "asc" as const }];

export const cookSkill = (s: string | null | undefined): CookSkill => (s === "skilled" ? "skilled" : "beginner");
export const stepSkill = (s: string | null | undefined): Skill => (s === "skilled" || s === "beginner" ? s : "either");

/** A user row (with profile) → the household fields the kitchen needs. Never carries health data. */
export function toMember(u: { id: string; slug: string; name: string; profile?: { portionFactor?: number | null; cookingSkill?: string | null } | null }): Member {
  return { id: u.id, slug: u.slug, name: u.name, portionFactor: u.profile?.portionFactor ?? 1, cookingSkill: cookSkill(u.profile?.cookingSkill) };
}

/** Is this line part of `personId`'s plate? Shared lines are everyone's; `null` person = shared lines only. */
export const ownsLine = (l: { forUserId: string | null }, personId: string | null): boolean => l.forUserId == null || l.forUserId === personId;

/** A positive portion factor (0 / missing = 1). */
export const pfOf = (p: { portionFactor?: number | null }): number => (p.portionFactor != null && p.portionFactor > 0 ? p.portionFactor : 1);

/** Sum of the members' portion factors: how many standard portions one meal for all of them takes. */
export const portionSum = (people: { portionFactor?: number | null }[]): number => people.reduce((a, e) => a + pfOf(e), 0);

/** Portions one meal for the household takes, as whole plates (prep batches and frozen portions count plates). */
export const plates = (people: unknown[]): number => Math.max(1, people.length);

/** "Alex", "Alex & Sam", "Alex, Sam & Robin". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}

/** Possessive label: "Alex's". */
export const possessive = (name: string) => `${name}${name.endsWith("s") ? "'" : "'s"}`;

/** Member name by id ("" when unknown). */
export const nameOf = (people: { id: string; name: string }[], id: string | null | undefined) => people.find((p) => p.id === id)?.name ?? "";

// ---- Legacy data (before the household model) ---------------------------------------------------------
// Old rows named one of two fixed handles: lines "both" | "alex" | "sam", steps "alex" | "sam" | "either".
// The SQL migration (prisma/migrations/20261118120000_household) applies exactly this rule to existing rows;
// the JSON import applies it to old-format recipe exports.

/**
 * Old handle → user: "alex" = the user with slug alex, else the oldest user whose slug is not "sam";
 * "sam" = the user with slug sam, else the oldest user that is not the "alex" user. Oldest = createdAt, then id.
 */
export function legacyOwnerSlugs(users: { id: string; slug: string; createdAt: Date }[]): { alex: string | null; sam: string | null } {
  const oldest = [...users].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const alex = users.find((u) => u.slug === "alex") ?? oldest.find((u) => u.slug !== "sam") ?? null;
  const sam = users.find((u) => u.slug === "sam") ?? oldest.find((u) => u.id !== alex?.id) ?? null;
  return { alex: alex?.slug ?? null, sam: sam?.slug ?? null };
}

/** Old step lane → skill. */
export function legacySkill(who: string | null | undefined): Skill {
  return who === "alex" ? "skilled" : who === "sam" ? "beginner" : stepSkill(who);
}

/**
 * Old-format recipe JSON → current draft fields, on a copy: ingredient `component` ("both" | handle)
 * becomes `for` ("" = shared, else the slug of the mapped household member), step `who` becomes `skill`.
 * New-format fields win when both are present. Unknown input passes through for the schema to reject.
 */
export function normalizeLegacyDraft(raw: unknown, owners: { alex: string | null; sam: string | null }): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const d = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(d.ingredients)) {
    const out: unknown[] = [];
    for (const i of d.ingredients) {
      if (!i || typeof i !== "object") {
        out.push(i);
        continue;
      }
      const { component, ...rest } = i as Record<string, unknown>;
      if (rest.for !== undefined || component === undefined) {
        out.push(rest);
        continue;
      }
      const c = String(component);
      const forSlug = c === "both" || c === "" ? "" : c === "alex" ? owners.alex : c === "sam" ? owners.sam : c;
      // a handle that maps to nobody: that person does not exist, so the line is dropped (same as the migration)
      if (forSlug != null) out.push({ ...rest, for: forSlug });
    }
    d.ingredients = out;
  }
  if (Array.isArray(d.steps)) {
    d.steps = d.steps.map((s) => {
      if (!s || typeof s !== "object") return s;
      const { who, ...rest } = s as Record<string, unknown>;
      return rest.skill !== undefined || who === undefined ? rest : { ...rest, skill: legacySkill(String(who)) };
    });
  }
  return d;
}
