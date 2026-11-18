import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";
import { isRealDay } from "@/lib/utils";
import { receiptMismatch } from "@/lib/costs";
import { loadPurchases } from "@/lib/spending";

// Shop receipts (household spending). Session only — no API-key scope.

export async function GET(req: Request) {
  const r = await withUser(req, null);
  if (r.error) return r.error;
  const rows = await loadPurchases();
  return ok({
    purchases: rows.map((p) => ({
      id: p.id,
      store: p.store,
      boughtOn: p.boughtOn.toISOString().slice(0, 10),
      total: p.total,
      note: p.note,
      items: p.items.map((i) => ({ name: i.name, kind: i.kind, price: i.price, grams: i.grams, ingredient: i.ingredient?.slug ?? null })),
    })),
  });
}

const money = z.number().min(0).max(100_000);
const item = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["food", "drink", "household"]).default("food"),
  price: money,
  grams: z.number().positive().max(100_000).nullish(),
  ingredient: z.string().trim().max(80).nullish(),
});
const create = z.object({
  store: z.string().trim().min(1).max(80),
  boughtOn: z.string().refine(isRealDay, "not a real date"),
  total: money,
  note: z.string().trim().max(300).default(""),
  items: z.array(item).min(1).max(200),
});

export async function POST(req: Request) {
  const r = await withUser(req, create);
  if (r.error) return r.error;
  const b = r.body;
  // The lines must add up to the printed total — a typo would otherwise skew every meal cost.
  const off = receiptMismatch(b.total, b.items.map((i) => i.price));
  if (off !== 0) return bad(`lines add up to ${(b.total - off).toFixed(2)}, receipt says ${b.total.toFixed(2)}`);
  const slugs = [...new Set(b.items.map((i) => i.ingredient).filter((s): s is string => !!s))];
  const known = await prisma.ingredient.findMany({ where: { slug: { in: slugs } }, select: { id: true, slug: true } });
  const bySlug = new Map(known.map((k) => [k.slug, k.id]));
  const unknown = slugs.filter((s) => !bySlug.has(s));
  if (unknown.length) return bad(`unknown ingredient: ${unknown.join(", ")}`);
  const p = await prisma.purchase.create({
    data: {
      store: b.store,
      boughtOn: new Date(`${b.boughtOn}T00:00:00Z`),
      total: b.total,
      note: b.note,
      createdById: r.user.id,
      items: {
        create: b.items.map((i, n) => ({
          name: i.name,
          kind: i.kind,
          price: i.price,
          grams: i.grams ?? null,
          ingredientId: i.ingredient ? bySlug.get(i.ingredient)! : null,
          sort: n,
        })),
      },
    },
    select: { id: true },
  });
  return ok({ id: p.id });
}

export async function DELETE(req: Request) {
  const r = await withUser(req, z.object({ id: zId }));
  if (r.error) return r.error;
  const n = await prisma.purchase.deleteMany({ where: { id: r.body.id } });
  return n.count ? ok() : bad("not found", 404);
}
