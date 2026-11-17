import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { encodeJwtSecret, signHs256 } from "@/lib/auth-core";

const BASE = "http://127.0.0.1:3030";
// Every real request carries a Host header; default to the published port unless a test sets one.
const req = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) => new NextRequest(new URL(path, BASE), { method: init.method ?? "GET", headers: { host: "127.0.0.1:3030", ...init.headers } });
const token = () => signHs256({ userId: "cuser", email: "alex@kitchen.local" }, encodeJwtSecret(process.env.JWT_SECRET, { minLength: 32 }), { expiresIn: "1h" });

describe("proxy: CSRF", () => {
  it("rejects a POST without Origin", async () => {
    const r = await proxy(req("/api/auth/login", { method: "POST", headers: { host: "127.0.0.1:3030" } }));
    expect(r.status).toBe(403);
  });
  it("rejects a cross-site Origin", async () => {
    const r = await proxy(req("/api/cook", { method: "POST", headers: { host: "127.0.0.1:3030", origin: "https://evil.example" } }));
    expect(r.status).toBe(403);
  });
  it("rejects Origin: null", async () => {
    const r = await proxy(req("/api/cook", { method: "POST", headers: { host: "127.0.0.1:3030", origin: "null" } }));
    expect(r.status).toBe(403);
  });
  it("lets a same-origin login POST through (public route)", async () => {
    const r = await proxy(req("/api/auth/login", { method: "POST", headers: { host: "127.0.0.1:3030", origin: BASE } }));
    expect(r.status).toBe(200);
    expect(r.headers.get("content-security-policy")).toContain("script-src 'self' 'unsafe-inline'");
  });
});

describe("proxy: auth gate + CSP", () => {
  it("returns 401 JSON for an API call without a session", async () => {
    const r = await proxy(req("/api/recipes"));
    expect(r.status).toBe(401);
  });
  it("redirects a page without a session to /login", async () => {
    const r = await proxy(req("/dashboard"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toContain("/login");
  });
  it("rejects a forged token", async () => {
    const r = await proxy(req("/api/recipes", { headers: { cookie: "kitchen_session=eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiJ4In0.bad" } }));
    expect(r.status).toBe(401);
  });
  it("passes a valid session with a per-request nonce CSP", async () => {
    const r = await proxy(req("/dashboard", { headers: { cookie: `kitchen_session=${await token()}` } }));
    expect(r.status).toBe(200);
    const csp = r.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("img-src 'self' data: blob:");
  });
});

describe("proxy: Host allowlist", () => {
  it("lets the loopback port and the container healthcheck through", async () => {
    for (const host of ["127.0.0.1:3030", "localhost:3030", "127.0.0.1:3000", "localhost:3000"]) {
      const r = await proxy(req("/api/health", { headers: { host } }));
      expect(r.status, host).toBe(200);
    }
  });
  it("answers 421 for any other Host, before auth or rate limiting", async () => {
    for (const host of ["evil.example", "192.168.1.60", "192.168.1.60:8080", "127.0.0.1:3030.evil.example", "kitchen.local", ""]) {
      const r = await proxy(req("/api/recipes", { headers: { host } }));
      expect(r.status, host).toBe(421);
      expect(await r.text()).toBe("Misdirected request");
    }
  });
  it("ALLOWED_HOSTS replaces the defaults; empty means defaults", async () => {
    process.env.ALLOWED_HOSTS = " Kitchen.example:8443 , ";
    try {
      expect((await proxy(req("/api/health", { headers: { host: "kitchen.example:8443" } }))).status).toBe(200);
      expect((await proxy(req("/api/health"))).status).toBe(421);
      process.env.ALLOWED_HOSTS = "";
      expect((await proxy(req("/api/health"))).status).toBe(200);
    } finally {
      delete process.env.ALLOWED_HOSTS;
    }
  });
});

describe("proxy: public static files", () => {
  it("serves the exact files and the two prefixes without a session, with the public CSP", async () => {
    for (const p of ["/favicon.svg", "/favicon.ico", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/x.png", "/_next/static/chunk.js"]) {
      const r = await proxy(req(p));
      expect(r.status, p).toBe(200);
      expect(r.headers.get("content-security-policy"), p).toContain("script-src 'self' 'unsafe-inline'");
      expect(r.headers.get("content-security-policy"), p).toContain("frame-ancestors 'none'");
    }
  });
  it("sends look-alike paths through the auth gate", async () => {
    for (const p of ["/iconsX", "/iconsX/a.png", "/favicon-anything", "/favicon.svg.bak", "/manifest.webmanifest.json", "/_nextX", "/api/icons/x.png"]) {
      const r = await proxy(req(p));
      expect([307, 401], p).toContain(r.status);
    }
  });
});

describe("proxy: rate limit", () => {
  it("answers 429 after 60 writes per minute from one client", async () => {
    const t = await token();
    let last = 0;
    for (let i = 0; i < 62; i++) {
      const r = await proxy(req("/api/stock", { method: "POST", headers: { host: "127.0.0.1:3030", origin: BASE, cookie: `kitchen_session=${t}` } }));
      last = r.status;
    }
    expect(last).toBe(429);
  });
  it("never limits /api/health", async () => {
    for (let i = 0; i < 300; i++) await proxy(req("/api/health"));
    expect((await proxy(req("/api/health"))).status).toBe(200);
  });
});
