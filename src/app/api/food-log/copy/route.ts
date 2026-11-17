import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";
import { copyRows, MEALS } from "@/lib/food-log";
import { isRealDay } from "@/lib/utils";

// Copy food-log entries onto a day: a whole day / one meal ("day"), or one entry re-logged from Recent
// ("entry"). Private: every read and write is the caller's own rows (userId = me), never anyone else's.
const Day = z.string().refine(isRealDay, "invalid date");
const Body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("day"), from: Day, to: Day, meal: z.enum(MEALS).optional() }),
  z.object({ mode: z.literal("entry"), entryId: zId, to: Day, meal: z.enum(MEALS) }),
]);

const at = (d: string) => new Date(`${d}T00:00:00Z`);

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const b = r.body;
  const userId = r.user.id;
  const pick = { meal: true, label: true, recipeId: true, portions: true, kcal: true, protein: true, netCarbs: true, fat: true } as const;

  if (b.mode === "entry") {
    const src = await prisma.foodLog.findFirst({ where: { id: b.entryId, userId }, select: pick });
    if (!src) return bad("entry not found", 404);
    await prisma.foodLog.create({ data: { ...src, meal: b.meal, userId, date: at(b.to) } });
    return ok({ ok: true, copied: 1, skipped: 0 });
  }

  if (b.from === b.to) return bad("pick another day to copy from");
  const [source, existing] = await Promise.all([
    prisma.foodLog.findMany({ where: { userId, date: at(b.from), ...(b.meal ? { meal: b.meal } : {}) }, orderBy: { createdAt: "asc" }, select: pick }),
    prisma.foodLog.findMany({ where: { userId, date: at(b.to) }, select: pick }),
  ]);
  if (!source.length) return bad(b.meal ? `nothing logged for ${b.meal} on ${b.from}` : `nothing logged on ${b.from}`, 404);
  const { rows, skipped } = copyRows(source, existing, b.meal);
  if (rows.length) await prisma.foodLog.createMany({ data: rows.map((x) => ({ ...x, userId, date: at(b.to) })) });
  return ok({ ok: true, copied: rows.length, skipped });
}
