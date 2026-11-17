import { z } from "zod";
import { bad, ok, withUser } from "@/lib/api";
import { logPlanDay } from "@/lib/plan-log";
import { isRealDay, localDay } from "@/lib/utils";

// "Ate today's plan": logs the day's planned slots for the CALLER only (userId = me, my own portion), takes a
// frozen-sauce portion off its batch, and logs nothing twice (FoodLog.planKey). Never a day in the future.
const Body = z.object({ date: z.string().refine(isRealDay, "invalid date") });

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  if (r.body.date > localDay()) return bad("that day has not happened yet");
  const res = await logPlanDay(r.user, r.body.date);
  if (!res) return bad(`no meal plan for ${r.body.date}`, 404);
  return ok({ ok: true, ...res });
}
