import { z } from "zod";
import { bad, ok, publicError, withUser, zId } from "@/lib/api";
import { applyLeftovers, lockSlot, PlanActionError, setSlot, solveInstantWeek, swapSlot } from "@/lib/plan-actions";
import { logError, requestIdOf } from "@/lib/log";
import { weekStart } from "@/lib/utils";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("swap"), slotId: zId }),
  z.object({ action: z.literal("lock"), slotId: zId, locked: z.boolean() }),
  z.object({ action: z.literal("leftover"), slotId: zId, fromSlotId: zId }),
  z.object({ action: z.literal("set"), slotId: zId, recipeId: zId }),
  z.object({ action: z.literal("solve"), weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
]);

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const b = r.body;
  try {
    if (b.action === "solve") {
      const res = await solveInstantWeek(b.weekStart ? weekStart(new Date(`${b.weekStart}T00:00:00Z`)) : weekStart(new Date()));
      return ok({ ok: true, ...res });
    }
    if (b.action === "lock") await lockSlot(b.slotId, b.locked);
    else if (b.action === "leftover") await applyLeftovers(b.slotId, b.fromSlotId);
    else if (b.action === "set") await setSlot(b.slotId, b.recipeId);
    else return ok({ ok: true, recipe: await swapSlot(b.slotId) });
    return ok();
  } catch (e) {
    if (e instanceof PlanActionError) return bad(e.message, e.status);
    logError("plan action failed", { requestId: requestIdOf(req), action: b.action, err: e });
    return bad(publicError(e), 500);
  }
}
