import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "./auth";
import { bearerOf, userForKey, type Scope } from "./api-keys";

export type ApiUser = NonNullable<Awaited<ReturnType<typeof currentUser>>>;

/** Default JSON body cap. A route that takes a bigger payload (CSV text) passes its own. */
export const DEFAULT_MAX_BODY = 1_000_000;

export class BodyTooLarge extends Error {}

/**
 * Read a JSON body without ever holding more than `maxBytes`: a declared Content-Length over the cap
 * is refused before reading, and a body without one (chunked) is counted while it streams.
 */
export async function readJsonCapped(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > maxBytes) throw new BodyTooLarge();
  if (!req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLarge();
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

type Guarded<T extends z.ZodType> = { user: ApiUser; body: z.infer<T>; error?: undefined } | { error: NextResponse; user?: undefined; body?: undefined };

/** Auth + capped body read + zod parsing for API routes. Returns either the data or a ready error response. Session only — an API key is refused. */
export async function withUser<T extends z.ZodType>(req: Request | null, schema: T | null, maxBytes: number = DEFAULT_MAX_BODY): Promise<Guarded<T>> {
  if (req && bearerOf(req)) return { error: NextResponse.json({ error: "This endpoint does not accept API keys" }, { status: 403 }) };
  const user = await currentUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  return parseBody(user, req, schema, maxBytes);
}

/**
 * Like withUser, but an API key with one of `scopes` is accepted too (`Authorization: Bearer kit_…`).
 * A request that carries a key is judged by the key alone — the proxy strips its cookie.
 */
export async function withScoped<T extends z.ZodType>(req: Request, schema: T | null, scopes: Scope | readonly Scope[], maxBytes: number = DEFAULT_MAX_BODY): Promise<Guarded<T>> {
  const raw = bearerOf(req);
  let user: ApiUser | null;
  if (raw) {
    const k = await userForKey(raw, typeof scopes === "string" ? [scopes] : scopes);
    if (!k.user) return { error: NextResponse.json({ error: k.error }, { status: k.status }) };
    user = k.user;
  } else {
    user = await currentUser();
    if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  return parseBody(user, req, schema, maxBytes);
}

async function parseBody<T extends z.ZodType>(user: ApiUser, req: Request | null, schema: T | null, maxBytes: number): Promise<Guarded<T>> {
  if (!schema || !req) return { user, body: undefined as z.infer<T> };
  let raw: unknown;
  try {
    raw = await readJsonCapped(req, maxBytes);
  } catch (e) {
    if (e instanceof BodyTooLarge) return { error: NextResponse.json({ error: `Request too large (max ${Math.round(maxBytes / 1_000_000)} MB)` }, { status: 413 }) };
    raw = null;
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { error: NextResponse.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 }) };
  }
  return { user, body: parsed.data };
}

export const ok = (data: unknown = { ok: true }) => NextResponse.json(data);
export const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/**
 * Upload guard: refuse before buffering when Content-Length is missing or over the limit (413).
 * Call BEFORE req.formData() — formData() reads the whole body into memory.
 */
export function uploadTooLarge(req: Request, maxBytes: number): NextResponse | null {
  const len = Number(req.headers.get("content-length") ?? "NaN");
  if (!Number.isFinite(len)) return NextResponse.json({ error: "Content-Length required" }, { status: 411 });
  if (len > maxBytes) return NextResponse.json({ error: `Upload too large (max ${Math.round(maxBytes / 1024 / 1024)} MB)` }, { status: 413 });
  return null;
}

/** cuid-shaped id check for route params / bodies (400 on anything else). */
export const CUID = /^c[a-z0-9]{20,32}$/;
export const isCuid = (s: string) => CUID.test(s);
export const zId = z.string().regex(CUID, "invalid id");

/** Error text that is safe to show: our own messages pass, anything else becomes generic. */
export function publicError(e: unknown, fallback = "Something went wrong — see the server log"): string {
  const m = e instanceof Error ? e.message : "";
  return /^(Prisma|Invalid `|\s*at |ECONN|connect )/.test(m) || !m ? fallback : m.slice(0, 300);
}
