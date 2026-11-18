// Who the seed creates: the household from the environment. Pure — tested in tests/household.test.ts.

// The .env.example value ("change-me-12-chars-or-more") and any other "change me" / placeholder wording.
const PLACEHOLDER_PW = /change[-_ ]?me|placeholder/i;

export interface SeedUser { slug: string; name: string; email: string; pw: string }

/**
 * The household from the environment: SEED_USERS = comma list of slugs (default "alex,sam"), and per slug
 * SEED_<SLUG>_PASSWORD (required, 12+ characters), SEED_<SLUG>_EMAIL (default <slug>@example.com) and
 * SEED_<SLUG>_NAME (default the slug, capitalised). A slug is lower-case letters, digits and dashes.
 */
export function seedUsers(env: Record<string, string | undefined> = process.env): SeedUser[] {
  const slugs = [...new Set((env.SEED_USERS ?? "alex,sam").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (!slugs.length) throw new Error("SEED_USERS is empty: name at least one person (e.g. SEED_USERS=alex)");
  return slugs.map((slug) => {
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(slug)) throw new Error(`SEED_USERS: "${slug}" is not a valid slug (a-z, 0-9, dashes, max 24)`);
    const key = `SEED_${slug.toUpperCase().replace(/-/g, "_")}`;
    const pw = env[`${key}_PASSWORD`] ?? "";
    if (!pw) throw new Error(`${key}_PASSWORD missing in .env`);
    if (pw.length < 12) throw new Error(`${key}_PASSWORD must be at least 12 characters`);
    if (PLACEHOLDER_PW.test(pw)) throw new Error(`${key}_PASSWORD is still the .env.example placeholder. Set a real password in .env (e.g. openssl rand -hex 16) and start again.`);
    const email = (env[`${key}_EMAIL`] || `${slug}@example.com`).toLowerCase();
    const name = env[`${key}_NAME`] || slug.charAt(0).toUpperCase() + slug.slice(1);
    return { slug, name, email, pw };
  });
}
