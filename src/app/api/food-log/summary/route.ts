import { prisma } from "@/lib/prisma";
import { bad, ok, withScoped } from "@/lib/api";
import { groupsToDays } from "@/lib/food-log-range";
import { isRealDay } from "@/lib/utils";

const MAX_RANGE_DAYS = 366;

// MY per-day totals between two days (inclusive), ≤ 366 days, summed in SQL (groupBy) — no entry rows, so a
// year stays small. Feeds the 3-month / 6-month / 1-year food-log views. For API keys too (food-log:read).
export async function GET(req: Request) {
  const r = await withScoped(req, null, ["food-log:read", "food-log:write"]);
  if (r.error) return r.error;
  const sp = new URL(req.url).searchParams;
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? from;
  if (!isRealDay(from) || !isRealDay(to)) return bad("from/to must be YYYY-MM-DD");
  const a = new Date(`${from}T00:00:00Z`);
  const b = new Date(`${to}T00:00:00Z`);
  if (b < a) return bad("to is before from");
  if ((b.getTime() - a.getTime()) / 86_400_000 >= MAX_RANGE_DAYS) return bad(`at most ${MAX_RANGE_DAYS} days`);
  const groups = await prisma.foodLog.groupBy({
    by: ["date"],
    where: { userId: r.user.id, date: { gte: a, lte: b } },
    _sum: { kcal: true, protein: true, netCarbs: true, fat: true },
    _count: { _all: true },
    orderBy: { date: "asc" },
  });
  return ok({ from, to, days: groupsToDays(groups) });
}
