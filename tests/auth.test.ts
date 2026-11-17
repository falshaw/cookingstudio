import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { encodeJwtSecret, hashPassword, signHs256, verifyHs256, verifyPassword } from "@/lib/auth-core";
import { lockState, MAX_FAILED_ATTEMPTS, LOCKOUT_MS } from "@/lib/lockout";

const secret = encodeJwtSecret("x".repeat(40), { minLength: 32 });

describe("auth core (vendored)", () => {
  it("hashes with bcrypt and verifies", async () => {
    const h = await hashPassword("correct horse");
    expect(h).toMatch(/^\$2[aby]\$12\$/);
    expect(await verifyPassword("correct horse", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  }, 20_000);
  it("rejects short or missing secrets", () => {
    expect(() => encodeJwtSecret("short", { minLength: 32 })).toThrow();
    expect(() => encodeJwtSecret(undefined)).toThrow();
  });
  it("signs and verifies an HS256 session token", async () => {
    const t = await signHs256({ userId: "u1", email: "alex@kitchen.local" }, secret, { expiresIn: "7d", jti: "j1" });
    const p = await verifyHs256(t, secret);
    expect(p.userId).toBe("u1");
    expect(p.jti).toBe("j1");
  });
  it("rejects a token signed with another key", async () => {
    const t = await signHs256({ userId: "u1" }, encodeJwtSecret("y".repeat(40)));
    await expect(verifyHs256(t, secret)).rejects.toThrow();
  });
  it("pins HS256 (rejects HS512 even with the right key)", async () => {
    const t = await new SignJWT({ userId: "u1" }).setProtectedHeader({ alg: "HS512" }).setExpirationTime("1h").sign(secret);
    await expect(verifyHs256(t, secret)).rejects.toThrow();
  });
  it("rejects an expired token", async () => {
    const t = await new SignJWT({ userId: "u1" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt(1).setExpirationTime(2).sign(secret);
    await expect(verifyHs256(t, secret)).rejects.toThrow();
  });
});

describe("login lockout", () => {
  it("is unlocked without a date or after it passed", () => {
    expect(lockState(null).locked).toBe(false);
    expect(lockState(new Date(Date.now() - 1000)).locked).toBe(false);
  });
  it("reports minutes left while locked", () => {
    const now = new Date();
    const s = lockState(new Date(now.getTime() + LOCKOUT_MS), now);
    expect(s.locked).toBe(true);
    expect(s.minutesLeft).toBe(15);
    expect(MAX_FAILED_ATTEMPTS).toBe(5);
  });
});
