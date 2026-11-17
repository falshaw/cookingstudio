import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser, zId } from "@/lib/api";
import { isRealDay } from "@/lib/utils";

// Health data: each user writes ONLY their own tracker; it stays in this database and is never
// sent to an outside service or into any prompt.
const Row = z.object({
  marker: z.string().min(1).max(80),
  value: z.number().finite().nullable(),
  unit: z.string().max(30).default(""),
  refLow: z.number().finite().nullable().default(null),
  refHigh: z.number().finite().nullable().default(null),
  date: z.string().refine(isRealDay, "not a real date").nullable(),
  flag: z.string().max(40).nullable().default(null),
  note: z.string().max(300).nullable().default(null),
});

const toData = (r: z.infer<typeof Row>) => ({ ...r, date: r.date ? new Date(`${r.date}T00:00:00Z`) : null });

export async function POST(req: Request) {
  const r = await withUser(req, Row);
  if (r.error) return r.error;
  const row = await prisma.labResult.create({ data: { userId: r.user.id, source: "manual", ...toData(r.body) } });
  return ok({ ok: true, id: row.id });
}

export async function DELETE(req: Request) {
  const r = await withUser(req, z.object({ id: zId }));
  if (r.error) return r.error;
  const n = await prisma.labResult.deleteMany({ where: { id: r.body.id, userId: r.user.id } });
  return n.count ? ok() : bad("not found", 404);
}
