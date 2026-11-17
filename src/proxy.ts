import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { clientIp, enforce, MIN } from "@/lib/ratelimit";

const PUBLIC_ROUTES = ["/login", "/api/auth/login", "/api/health"];
// Static files reachable without a session: exact file names, plus two directory prefixes
// with the trailing slash (so /iconsX or /favicon-anything still hit the auth gate).
const PUBLIC_FILES = ["/favicon.svg", "/favicon.ico", "/manifest.webmanifest"];
const PUBLIC_PREFIXES = ["/_next/", "/icons/"];

// Host allowlist (DNS-rebinding / stray-vhost guard). Defaults: the loopback port and the container's
// own :3000 (Docker healthcheck). To reach the app from another device, add its host:port to
// ALLOWED_HOSTS (comma list, overrides the defaults).
const DEFAULT_HOSTS = ["127.0.0.1:3030", "localhost:3030", "127.0.0.1:3000", "localhost:3000"];
function allowedHosts(): string[] {
  const env = (process.env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
  return env.length ? env : DEFAULT_HOSTS;
}

const COOKIE_NAME = "kitchen_session";

// Parity with src/lib/auth.ts (min 32 chars + the same weak-value list) so the
// edge verifier can't accept a secret the app layer would reject.
const KNOWN_WEAK = ["changeme", "change-me", "placeholder", "your-secret", "min_32_chars", "example-secret"];
function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32 || KNOWN_WEAK.some((w) => secret.toLowerCase().includes(w))) {
    throw new Error("JWT_SECRET missing or weak");
  }
  return new TextEncoder().encode(secret);
}

function generateCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'unsafe-inline'`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self' data:",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

// /login is PRERENDERED at build time, so no per-request nonce can reach its
// inline bootstrap scripts — a nonce + 'strict-dynamic' policy would block them
// and kill the sign-in form. Public pages get the same policy minus the nonce.
const PUBLIC_CSP = generateCsp("").replace(
  "script-src 'self' 'nonce-' 'strict-dynamic'",
  "script-src 'self' 'unsafe-inline'",
);

function publicResponse(request: NextRequest) {
  // The correlation id goes on public requests too: a `login failed` log line without one
  // could not be matched to its request. Always overwritten — a client
  // must not be able to choose its own.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-request-id", crypto.randomUUID());
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", PUBLIC_CSP);
  return response;
}

// Per-IP ceilings for /api/*. Deliberately generous — this is a single-user app,
// so the job is to bound a runaway loop or a scripted probe, not to police normal
// use. /api/auth/login keeps its own much tighter limit inside the route.
const API_WRITE_PER_MIN = 60;
const API_READ_PER_MIN = 240;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const host = request.headers.get("host")?.toLowerCase() ?? "";
  if (!allowedHosts().includes(host)) {
    return new NextResponse("Misdirected request", { status: 421, headers: { "Content-Type": "text/plain" } });
  }

  if (PUBLIC_FILES.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)))
    return publicResponse(request);

  // Rate limit every API route from one place — 26 handlers, so per-route
  // limiters would drift the moment someone adds the 27th. Health is exempt:
  // Docker polls it every 30s and a throttled probe would flap the container.
  // Images are exempt: a page like the ingredient guide loads 100+ thumbnails at once (still auth-gated below).
  if (pathname.startsWith("/api/") && pathname !== "/api/health" && !pathname.startsWith("/api/images/")) {
    const write = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
    const limited = enforce(
      `api:${write ? "w" : "r"}:${clientIp(request.headers)}`,
      write ? API_WRITE_PER_MIN : API_READ_PER_MIN,
      MIN,
    );
    if (limited) return limited;
  }

  // API key: `Authorization: Bearer kit_…` on /api/* is passed on WITHOUT its cookie, so the
  // route judges the key alone (`withScoped` checks key + scope; `withUser` refuses keys with 403).
  // No CSRF check needed: a browser can't attach this header cross-site (no CORS is ever allowed here).
  if (pathname.startsWith("/api/") && /^Bearer [^\s]+$/.test(request.headers.get("authorization") ?? "")) {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.delete("cookie");
    requestHeaders.set("x-request-id", crypto.randomUUID());
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // CSRF validation for state-changing requests — runs BEFORE the public-route
  // exemption so POST /api/auth/login is covered too (login-CSRF).
  const method = request.method;
  if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const origin = request.headers.get("origin");
    if (!origin) {
      return NextResponse.json(
        { error: "CSRF validation failed: missing origin" },
        { status: 403 },
      );
    }
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      // `Origin: null` (sandboxed iframe, some cross-site redirects) is not a
      // URL — refuse it as a CSRF failure rather than throwing into a 500.
    }
    if (!originHost || originHost !== host) {
      return NextResponse.json(
        { error: "CSRF validation failed" },
        { status: 403 },
      );
    }
  }

  if (PUBLIC_ROUTES.includes(pathname)) return publicResponse(request);

  // Verify JWT (lightweight — no DB calls here).
  // DB session validation happens in API routes / server components.
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ["HS256"],
    });

    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    const nonce = btoa(String.fromCharCode(...buf));
    const csp = generateCsp(nonce);

    // Next reads the nonce for its own scripts off the REQUEST's CSP header,
    // so it goes on both sides.
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-user-id", payload.userId as string);
    requestHeaders.set("x-request-id", crypto.randomUUID());
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);

    const response = NextResponse.next({
      request: { headers: requestHeaders },
    });
    response.headers.set("Content-Security-Policy", csp);
    response.headers.set("x-nonce", nonce);

    return response;
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
