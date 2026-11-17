// Ticking an item "bought" on the shopping list puts its ingredient in stock (a purchase);
// unticking undoes exactly what that tick did. One function for the /shopping page and the API.
// Relative imports so scripts can run it under tsx.
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { addDays, isoDate, localDay } from "./utils";

/** The two stock fields a tick changes. bestBefore = YYYY-MM-DD or null. */
export interface StockState { status: string; bestBefore: string | null }
/** Stored on ShoppingItem.stockUndo: the stock row before the tick (null = there was none) and what the tick wrote. */
export interface StockUndo { prev: StockState | null; wrote: StockState }

/**
 * Stock state after buying. Best-before = today (APP_TIMEZONE) + keepsDays. When stock was already "in"
 * with a date, the LATER date wins: a hand-entered printed date is not shortened by the rough keepsDays
 * figure, and the fresh pack is most of what is in the fridge now. A low/out row's old date is stale and
 * is replaced (null when the ingredient has no keepsDays).
 */
export function boughtState(prev: StockState | null, keepsDays: number | null, today: string): StockState {
  const fresh = keepsDays != null && keepsDays > 0 ? addDays(today, keepsDays) : null;
  if (prev?.status === "in" && prev.bestBefore) return { status: "in", bestBefore: !fresh || prev.bestBefore > fresh ? prev.bestBefore : fresh };
  return { status: "in", bestBefore: fresh };
}

const same = (a: StockState | null, b: StockState | null) => !!a && !!b && a.status === b.status && a.bestBefore === b.bestBefore;

export type RevertAction = { kind: "none" } | { kind: "delete" } | { kind: "restore"; state: StockState };

/**
 * What unticking does to the stock row. Only reverts when the row still holds what the tick wrote —
 * if someone changed it since (marked it low, edited the date, removed it) their edit wins.
 */
export function revertAction(undo: StockUndo, current: StockState | null): RevertAction {
  if (!same(current, undo.wrote)) return { kind: "none" };
  return undo.prev ? { kind: "restore", state: undo.prev } : { kind: "delete" };
}

/**
 * Two ticked items for the same ingredient (base line + someone's extra) stack: the second one's `prev`
 * is the first one's `wrote`. Unticking the first while the second is still ticked must not touch stock —
 * it hands its own `prev` down to the item stacked on it, so the last untick restores the original state.
 */
export function handOver(undo: StockUndo, others: { id: string; undo: StockUndo }[]): { id: string; undo: StockUndo } | null {
  const top = others.find((o) => same(o.undo.prev, undo.wrote));
  return top ? { id: top.id, undo: { prev: undo.prev, wrote: top.undo.wrote } } : null;
}

/** Location for a stock row the tick creates (an existing row keeps its location). */
export function stockLocation(ing: { kind: string; storeWhere: string }): string {
  if (ing.kind === "spice" || ing.kind === "herb") return "spices";
  return ["fridge", "freezer", "pantry"].includes(ing.storeWhere) ? ing.storeWhere : "pantry";
}

export function parseUndo(v: unknown): StockUndo | null {
  if (!v || typeof v !== "object") return null;
  const u = v as Partial<StockUndo>;
  const ok = (s: unknown): s is StockState => !!s && typeof s === "object" && typeof (s as StockState).status === "string" && ((s as StockState).bestBefore === null || typeof (s as StockState).bestBefore === "string");
  if (!ok(u.wrote) || (u.prev !== null && !ok(u.prev))) return null;
  return { prev: u.prev, wrote: u.wrote };
}

const toDate = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);

export interface TickResult { checked: boolean; changed: boolean; stock: "added" | "reverted" | "kept" | null; bestBefore: string | null }

/**
 * Set a shopping item's tick and keep stock in step. Idempotent: re-sending the same tick
 * (e.g. a client that resends every tick) changes nothing. Returns null for an unknown item.
 */
export async function setShoppingTick(itemId: string, checked: boolean, now = new Date()): Promise<TickResult | null> {
  return prisma.$transaction(async (tx) => {
    const item = await tx.shoppingItem.findUnique({ where: { id: itemId }, select: { id: true, checked: true, ingredientId: true, stockUndo: true } });
    if (!item) return null;
    // claim the transition atomically (two phones ticking at once: only one applies the stock write)
    const claimed = await tx.shoppingItem.updateMany({ where: { id: itemId, checked: !checked }, data: { checked } });
    if (!claimed.count) return { checked, changed: false, stock: parseUndo(item.stockUndo) ? "kept" : null, bestBefore: parseUndo(item.stockUndo)?.wrote.bestBefore ?? null };
    if (!item.ingredientId) return { checked, changed: true, stock: null, bestBefore: null }; // free-text item: no stock write

    const row = await tx.stockItem.findUnique({ where: { ingredientId: item.ingredientId } });
    const current: StockState | null = row ? { status: row.status, bestBefore: row.bestBefore ? isoDate(row.bestBefore) : null } : null;

    if (checked) {
      const ing = await tx.ingredient.findUnique({ where: { id: item.ingredientId }, select: { kind: true, storeWhere: true, keepsDays: true } });
      if (!ing) return { checked, changed: true, stock: null, bestBefore: null };
      const wrote = boughtState(current, ing.keepsDays, localDay(now));
      if (row) {
        await tx.stockItem.update({ where: { ingredientId: item.ingredientId }, data: { status: wrote.status, bestBefore: toDate(wrote.bestBefore) } });
      } else {
        const location = stockLocation(ing);
        await tx.stockItem.create({ data: { ingredientId: item.ingredientId, status: wrote.status, location, bestBefore: toDate(wrote.bestBefore), frozenAt: location === "freezer" ? now : null } });
      }
      const undo: StockUndo = { prev: current, wrote };
      await tx.shoppingItem.update({ where: { id: itemId }, data: { stockUndo: undo as unknown as Prisma.InputJsonValue } });
      return { checked, changed: true, stock: "added", bestBefore: wrote.bestBefore };
    }

    const undo = parseUndo(item.stockUndo);
    if (!undo) return { checked, changed: true, stock: null, bestBefore: null }; // the tick never wrote stock
    await tx.shoppingItem.update({ where: { id: itemId }, data: { stockUndo: Prisma.DbNull } });
    const stacked = await tx.shoppingItem.findMany({ where: { ingredientId: item.ingredientId, checked: true, id: { not: itemId }, NOT: { stockUndo: { equals: Prisma.DbNull } } }, select: { id: true, stockUndo: true } });
    const others = stacked.flatMap((o) => { const u = parseUndo(o.stockUndo); return u ? [{ id: o.id, undo: u }] : []; });
    const hand = handOver(undo, others);
    if (hand) {
      await tx.shoppingItem.update({ where: { id: hand.id }, data: { stockUndo: hand.undo as unknown as Prisma.InputJsonValue } });
      return { checked, changed: true, stock: "kept", bestBefore: current?.bestBefore ?? null };
    }
    const act = revertAction(undo, current);
    if (act.kind === "delete") await tx.stockItem.deleteMany({ where: { ingredientId: item.ingredientId } });
    if (act.kind === "restore") await tx.stockItem.update({ where: { ingredientId: item.ingredientId }, data: { status: act.state.status, bestBefore: toDate(act.state.bestBefore) } });
    return { checked, changed: true, stock: act.kind === "none" ? "kept" : "reverted", bestBefore: null };
  });
}
