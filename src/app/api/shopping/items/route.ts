import { z } from "zod";
import { bad, ok, withUser, zId } from "@/lib/api";
import { setShoppingTick } from "@/lib/stock-from-shopping";

// Tick = bought: an item that maps to an ingredient goes into stock; unticking undoes only what the tick did.
export async function PATCH(req: Request) {
  const r = await withUser(req, z.object({ id: zId, checked: z.boolean() }));
  if (r.error) return r.error;
  const res = await setShoppingTick(r.body.id, r.body.checked);
  if (!res) return bad("item not found", 404);
  return ok({ ok: true, stock: res.stock, bestBefore: res.bestBefore });
}
