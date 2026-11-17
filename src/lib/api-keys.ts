import { createHash, randomBytes } from "node:crypto";
import { prisma } from "./prisma";

// Personal API keys for scripts and assistants: each person makes their own key on /keys, it acts as
// them and only on the routes that name one of its scopes (`withScoped` in api.ts). Every other route
// stays session-only. Only sha256(key) is stored; the key itself is shown once.

export { SCOPES, SCOPE_LABELS, type Scope } from "./api-key-scopes";
import type { Scope } from "./api-key-scopes";

export const KEY_PREFIX = "kit_";
const KEY_RE = /^kit_[A-Za-z0-9_-]{43}$/;
export const MAX_KEYS_PER_USER = 10;
export const DEFAULT_KEY_DAYS = 90;
/** lastUsedAt is written at most once a minute per key */
const TOUCH_MS = 60_000;

export const newRawKey = () => KEY_PREFIX + randomBytes(32).toString("base64url");
export const keyHash = (raw: string) => createHash("sha256").update(raw).digest("hex");
/** What the list shows: enough to recognise a key, never enough to use it. */
export const keyHint = (raw: string) => `${raw.slice(0, 8)}…`;

/** The raw Bearer token of a request, or null. Only the exact `Bearer <token>` form counts. */
export function bearerOf(req: Request): string | null {
  const m = (req.headers.get("authorization") ?? "").match(/^Bearer ([^\s]+)$/);
  return m ? m[1] : null;
}

export type KeyUser = { id: string; slug: string; name: string; email: string };
export type KeyResult = { user: KeyUser; error?: undefined; status?: undefined } | { user?: undefined; error: string; status: 401 | 403 };

/**
 * Resolve a Bearer key to its owner. 401 = not a valid, live key; 403 = valid key without any of `scopes`.
 * Same message for "wrong format", "unknown" and "expired" so a probe learns nothing.
 */
export async function userForKey(raw: string, scopes: readonly Scope[], now = new Date()): Promise<KeyResult> {
  if (!KEY_RE.test(raw)) return { error: "Invalid or expired API key", status: 401 };
  const key = await prisma.apiKey.findUnique({
    where: { keyHash: keyHash(raw) },
    select: { id: true, scopes: true, expiresAt: true, lastUsedAt: true, user: { select: { id: true, slug: true, name: true, email: true } } },
  });
  if (!key || key.expiresAt <= now) return { error: "Invalid or expired API key", status: 401 };
  if (!scopes.some((s) => key.scopes.includes(s))) return { error: `This key may not do that (needs ${scopes.join(" or ")})`, status: 403 };
  if (!key.lastUsedAt || now.getTime() - key.lastUsedAt.getTime() > TOUCH_MS) {
    await prisma.apiKey.updateMany({ where: { id: key.id }, data: { lastUsedAt: now } }).catch(() => {});
  }
  return { user: key.user };
}
