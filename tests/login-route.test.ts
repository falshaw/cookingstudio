// Route-level lockout checks for POST /api/auth/login .
// Real lockout logic (src/lib/lockout.ts) over an in-memory users row; bcrypt and the
// session cookie are mocked, and so is the burst limiter. 5 wrong passwords lock the account; once locked, every
// password (right or wrong) gets the generic 401 until the lock expires.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; email: string; name: string; passwordHash: string; failedLoginAttempts: number; lockedUntil: Date | null; lastLoginAt: Date | null };
const h = vi.hoisted(() => ({ user: null as null | Row, sessions: 0 }));

vi.mock("@/lib/prisma", () => {
  const match = (where: { id?: string; email?: string; failedLoginAttempts?: number }) =>
    h.user &&
    (where.id === undefined || where.id === h.user.id) &&
    (where.email === undefined || where.email === h.user.email) &&
    (where.failedLoginAttempts === undefined || where.failedLoginAttempts === h.user.failedLoginAttempts)
      ? h.user
      : null;
  return {
    prisma: {
      user: {
        findUnique: async ({ where }: { where: { id?: string; email?: string } }) => (match(where) ? { ...h.user! } : null),
        findFirst: async () => (h.user ? { passwordHash: h.user.passwordHash } : null),
        update: async ({ where, data }: { where: { id: string }; data: Partial<Row> }) => {
          if (!match(where)) throw new Error("not found");
          Object.assign(h.user!, data);
          return { ...h.user! };
        },
        updateMany: async ({ where, data }: { where: { id: string; failedLoginAttempts: number }; data: Partial<Row> }) => {
          if (!match(where)) return { count: 0 };
          Object.assign(h.user!, data);
          return { count: 1 };
        },
      },
    },
  };
});
vi.mock("@/lib/auth", () => ({
  verifyPassword: vi.fn(async (password: string) => password === "right-password"),
  createSession: vi.fn(async () => {
    h.sessions += 1;
  }),
}));

// The burst limiter is not under test here; it would 429 the repeated logins.
vi.mock("@/lib/ratelimit", () => ({ enforce: () => null, clientIp: () => "local" }));

const { POST } = await import("@/app/api/auth/login/route");

const login = (password: string) =>
  POST(
    new Request("http://127.0.0.1/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "owner@example.test", password }),
      headers: { "content-type": "application/json" },
    }) as never,
  );

beforeEach(() => {
  h.sessions = 0;
  h.user = { id: "u1", email: "owner@example.test", name: "Owner", passwordHash: "stored", failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: null };
});

describe("POST /api/auth/login lockout", () => {
  it("5 wrong passwords lock the account, each answered with the generic 401", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await login("wrong");
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "Invalid credentials" });
    }
    expect(h.user!.lockedUntil).not.toBeNull();
    expect(h.user!.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    expect(h.user!.failedLoginAttempts).toBe(0);
  });

  it("4 wrong passwords do not lock", async () => {
    for (let i = 0; i < 4; i++) expect((await login("wrong")).status).toBe(401);
    expect(h.user!.lockedUntil).toBeNull();
    expect(h.user!.failedLoginAttempts).toBe(4);
  });

  it("locked + right password → generic 401, no session (no password oracle)", async () => {
    for (let i = 0; i < 5; i++) await login("wrong");
    const r = await login("right-password");
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Invalid credentials" });
    expect(h.sessions).toBe(0);
  });

  it("locked + wrong password → 401, same body as any wrong password", async () => {
    for (let i = 0; i < 5; i++) await login("wrong");
    const r = await login("wrong-again");
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Invalid credentials" });
  });

  it("right password before the lock signs in and clears the counter", async () => {
    for (let i = 0; i < 3; i++) await login("wrong");
    const r = await login("right-password");
    expect(r.status).toBe(200);
    expect(h.sessions).toBe(1);
    expect(h.user!.failedLoginAttempts).toBe(0);
    expect(h.user!.lastLoginAt).not.toBeNull();
  });

  it("expired lock lets the right password in", async () => {
    h.user!.lockedUntil = new Date(Date.now() - 1000);
    const r = await login("right-password");
    expect(r.status).toBe(200);
    expect(h.user!.lockedUntil).toBeNull();
  });
});
