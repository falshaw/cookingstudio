/**
 * Lightweight in-memory rate limiter (single app container; no Redis here).
 * Sliding fixed-window per key. Resets on restart — acceptable as a first line
 * against brute-force / abuse; the durable layer is the per-account lockout in
 * `lockout.ts`.
 */
import { NextResponse } from "next/server";

type Window = { count: number; reset: number };
const buckets = new Map<string, Window>();

export function rateLimit(key: string, max: number, windowMs: number): { ok: boolean; retryAfter: number } {
  const now = Date.now();
  // opportunistic prune to bound memory
  if (buckets.size > 5000) {
    for (const [k, w] of buckets) if (now > w.reset) buckets.delete(k);
  }
  const w = buckets.get(key);
  if (!w || now > w.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  w.count++;
  if (w.count > max) return { ok: false, retryAfter: Math.ceil((w.reset - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}

/**
 * Rate-limit key for the caller.
 *
 * Forwarded-IP headers only mean something behind a proxy that overwrites them
 * (a client-chosen `X-Forwarded-For` per request = a fresh bucket per request;
 * so compose defaults TRUST_PROXY=0 and all callers share the "local" bucket. Only with TRUST_PROXY=1 (a proxy that
 * overwrites the header) does the first X-Forwarded-For entry count.
 */
export function clientIp(headers: Headers): string {
  if (process.env.TRUST_PROXY !== "1") return "local";
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function tooMany(retryAfter: number) {
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    { status: 429, headers: { "Retry-After": String(retryAfter) } },
  );
}

/** Convenience: enforce a limit, returning a 429 response or null if allowed. */
export function enforce(key: string, max: number, windowMs: number): NextResponse | null {
  const r = rateLimit(key, max, windowMs);
  return r.ok ? null : tooMany(r.retryAfter);
}

export const MIN = 60_000;
export const HOUR = 3_600_000;
