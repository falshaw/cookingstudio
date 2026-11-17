import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword, createSession } from "@/lib/auth";
import { z } from "zod";

const LoginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) });
import { enforce, clientIp } from "@/lib/ratelimit";

import {
  clearFailures,
  lockState,
  registerFailure,
} from "@/lib/lockout";

// Fallback for the unknown-email path when the users table is empty: a real
// bcrypt hash (cost 12) of a throwaway string. The result is never used.
const DUMMY_HASH = "$2b$12$1un.Bhe7RLJuhTXH9uP.7OXNWgV.wncp6xDGZJVdZxdvYpahBRdTC";

export async function POST(request: NextRequest) {
  try {
    const rlIp = clientIp(request.headers);
    const ipLimited = enforce(`login:ip:${rlIp}`, 30, 60000);
    if (ipLimited) return ipLimited;

    const parsed = LoginSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    const email = parsed.data.email.toLowerCase().trim();
    const password = parsed.data.password;

    const emailLimited = enforce(`login:email:${email.toLowerCase().trim()}`, 20, 60000);
    if (emailLimited) return emailLimited;

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Same cost as a wrong password on a real account, so a caller cannot time
      // which emails exist. The cost that matters is the one baked into the STORED
      // hash (it can differ from BCRYPT_COST), so verify against a stored hash and
      // discard the result; the dummy only covers an empty users table.
      const any = await prisma.user.findFirst({ select: { passwordHash: true } });
      await verifyPassword(password, any?.passwordHash ?? DUMMY_HASH);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    // While the account is locked every caller gets the same generic 401, whatever
    // the password: answering differently for the right password turned the lock
    // into a password oracle (keep guessing during the lock, wait for the 423).
    // bcrypt still runs so timing matches the unlocked path; its result is unused.
    const locked = lockState(user.lockedUntil);
    if (locked.locked) {
      await verifyPassword(password, user.passwordHash);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }
    const passwordOk = await verifyPassword(password, user.passwordHash);

    if (!passwordOk) {
      // The attempt that trips the lock reads like any other wrong password.
      await registerFailure(user.id, user.failedLoginAttempts);
      return NextResponse.json(
        { error: "Invalid credentials" },
        { status: 401 },
      );
    }

    await clearFailures(user.id);

    const userAgent = request.headers.get("user-agent") ?? undefined;
    const ipKey = clientIp(request.headers);
    const ip = ipKey === "local" || ipKey === "unknown" ? undefined : ipKey;
    await createSession(user.id, user.email, userAgent, ip);

    return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch {
    // Fail-closed: anything that stops us reading or writing the lockout state
    // ends the request without a session.
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
