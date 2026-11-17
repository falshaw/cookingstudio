import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { encodeJwtSecret, signHs256, verifyHs256 } from "./auth-core";

// Re-export so `import { hashPassword/verifyPassword } from "@/lib/auth"`
// resolves to the shared bcrypt primitives.
export { hashPassword, verifyPassword } from "./auth-core";

const COOKIE_NAME = "kitchen_session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days (phone in the kitchen)

// Reject obvious dev/placeholder secrets so a real deployment can't ship with
// the .env.example default. Runtime-only (not evaluated during `next build`).
const KNOWN_WEAK = [
  "changeme",
  "change-me",
  "placeholder",
  "your-secret",
  "min_32_chars",
  "example-secret",
];

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (secret && KNOWN_WEAK.some((w) => secret.toLowerCase().includes(w))) {
    throw new Error(
      "JWT_SECRET is a known weak/placeholder value — set a strong random secret (openssl rand -hex 32)",
    );
  }
  return encodeJwtSecret(secret, { minLength: 32 });
}

/**
 * `sessions.token` holds sha256(jwt), never the JWT itself, so a database dump
 * or backup never carries live session tokens.
 * The cookie still carries the raw JWT; only the lookup key is hashed.
 */
export function sessionKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

interface TokenPayload {
  userId: string;
  email: string;
}

export async function createToken(payload: TokenPayload): Promise<string> {
  return signHs256({ ...payload }, getJwtSecret(), {
    expiresIn: "7d",
    jti: crypto.randomUUID(),
  });
}

export async function verifyToken(token: string): Promise<TokenPayload> {
  const payload = await verifyHs256(token, getJwtSecret());
  return {
    userId: payload.userId as string,
    email: payload.email as string,
  };
}

export async function createSession(
  userId: string,
  email: string,
  userAgent?: string,
  ipAddress?: string,
) {
  const token = await createToken({ userId, email });
  const expiresAt = new Date(Date.now() + SESSION_DURATION);

  // Prune expired sessions on each login. Best-effort: never blocks a login.
  await prisma.session
    .deleteMany({ where: { expiresAt: { lt: new Date() } } })
    .catch(() => {});

  await prisma.session.create({
    data: { userId, token: sessionKey(token), expiresAt, userAgent, ipAddress },
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return token;
}

export async function getSession(): Promise<TokenPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const payload = await verifyToken(token);
    const key = sessionKey(token);
    const session = await prisma.session.findUnique({ where: { token: key } });
    if (!session || session.expiresAt < new Date()) {
      if (session) await prisma.session.delete({ where: { token: key } });
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

/**
 * Resolve the signed-in user id for an API route. Middleware has already
 * verified the JWT and set `x-user-id`; this re-reads it and confirms the
 * DB session is still valid. Returns null if unauthenticated.
 */
export async function requireUserId(): Promise<string | null> {
  const session = await getSession();
  return session?.userId ?? null;
}

export async function deleteSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    await prisma.session
      .deleteMany({ where: { token: sessionKey(token) } })
      .catch(() => {});
    cookieStore.delete(COOKIE_NAME);
  }
}

/** The signed-in user (with slug + name), or null. For server components and API routes. */
export async function currentUser() {
  const session = await getSession();
  if (!session) return null;
  return prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, slug: true, name: true, email: true },
  });
}
