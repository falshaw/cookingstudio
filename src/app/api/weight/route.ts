import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withScoped, zId } from "@/lib/api";
import { isRealDay } from "@/lib/utils";

// Own weight entries only; one per day (a second entry the same day replaces it).
// My weight entries between two days (default: the last 90 days), oldest first. Keys: weight:read.
export async function GET(req: Request) {
  const r = await withScoped(req, null, ["weight:read", "weight:write"]);
  if (r.error) return r.error;
  const sp = new URL(req.url).searchParams;
  const to = sp.get("to") ?? new Date().toISOString().slice(0, 10);
  const from = sp.get("from") ?? new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  if (!isRealDay(from) || !isRealDay(to)) return bad("from/to must be YYYY-MM-DD");
  const rows = await prisma.weightEntry.findMany({
    where: { userId: r.user.id, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } },
    orderBy: { date: "asc" },
    select: { id: true, date: true, kg: true },
  });
  return ok({ entries: rows.map((e) => ({ ...e, date: e.date.toISOString().slice(0, 10) })) });
}

export async function POST(req: Request) {
  const r = await withScoped(req, z.object({ date: z.string().refine(isRealDay, "not a real date"), kg: z.number().min(25).max(400) }), "weight:write");
  if (r.error) return r.error;
  const date = new Date(`${r.body.date}T00:00:00Z`);
  await prisma.weightEntry.upsert({ where: { userId_date: { userId: r.user.id, date } }, create: { userId: r.user.id, date, kg: r.body.kg }, update: { kg: r.body.kg } });
  return ok();
}

export async function DELETE(req: Request) {
  const r = await withScoped(req, z.object({ id: zId }), "weight:write");
  if (r.error) return r.error;
  await prisma.weightEntry.deleteMany({ where: { id: r.body.id, userId: r.user.id } });
  return ok();
}
