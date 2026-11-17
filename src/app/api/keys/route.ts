import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";
import { DEFAULT_KEY_DAYS, keyHash, keyHint, MAX_KEYS_PER_USER, newRawKey, SCOPES } from "@/lib/api-keys";

// My API keys (scripts and assistants). Session only (withUser refuses a key), so a key can never make or delete keys.
// The key is returned ONCE by POST; afterwards only its hint, scopes and dates are shown.

export async function GET() {
  const r = await withUser(null, null);
  if (r.error) return r.error;
  const keys = await prisma.apiKey.findMany({
    where: { userId: r.user.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, hint: true, scopes: true, expiresAt: true, lastUsedAt: true, createdAt: true },
  });
  return ok({ keys });
}

const Create = z.object({
  name: z.string().trim().min(1).max(60),
  scopes: z.array(z.enum(SCOPES)).min(1).max(SCOPES.length),
  days: z.number().int().min(1).max(365).default(DEFAULT_KEY_DAYS),
});

export async function POST(req: Request) {
  const r = await withUser(req, Create);
  if (r.error) return r.error;
  const have = await prisma.apiKey.count({ where: { userId: r.user.id } });
  if (have >= MAX_KEYS_PER_USER) return bad(`At most ${MAX_KEYS_PER_USER} keys — delete one first`, 409);
  const raw = newRawKey();
  const expiresAt = new Date(Date.now() + r.body.days * 86_400_000);
  const k = await prisma.apiKey.create({
    data: { userId: r.user.id, name: r.body.name, hint: keyHint(raw), keyHash: keyHash(raw), scopes: [...new Set(r.body.scopes)], expiresAt },
    select: { id: true, name: true, hint: true, scopes: true, expiresAt: true },
  });
  return ok({ key: raw, ...k });
}

export async function DELETE(req: Request) {
  const r = await withUser(req, z.object({ id: zId }));
  if (r.error) return r.error;
  const del = await prisma.apiKey.deleteMany({ where: { id: r.body.id, userId: r.user.id } });
  if (!del.count) return bad("key not found", 404);
  return ok();
}
