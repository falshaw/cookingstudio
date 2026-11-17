import { z } from "zod";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bad, isCuid, ok, withUser } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { isRealDay } from "@/lib/utils";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return bad("Unauthorized", 401);
  const { id } = await ctx.params;
  if (!isCuid(id)) return bad("invalid id", 400);
  const imp = await prisma.labImport.findFirst({ where: { id, userId: user.id }, select: { id: true, status: true, extracted: true, error: true, fileName: true } });
  return imp ? NextResponse.json(imp) : bad("not found", 404);
}

const Confirm = z.object({
  rows: z
    .array(
      z.object({
        marker: z.string().min(1).max(80),
        value: z.number().finite().nullable(),
        unit: z.string().max(30),
        refLow: z.number().finite().nullable(),
        refHigh: z.number().finite().nullable(),
        date: z.string().refine(isRealDay, "not a real date").nullable(),
      }),
    )
    .max(80),
});

/** Saves only the rows the user ticked (and possibly corrected). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const r = await withUser(req, Confirm);
  if (r.error) return r.error;
  const { id } = await ctx.params;
  if (!isCuid(id)) return bad("invalid id", 400);
  const imp = await prisma.labImport.findFirst({ where: { id, userId: r.user.id } });
  if (!imp) return bad("not found", 404);
  if (imp.status !== "review") return bad(`import is ${imp.status}`, 409);
  await prisma.$transaction([
    prisma.labResult.createMany({
      data: r.body.rows.map((x) => ({ userId: r.user.id, marker: x.marker, value: x.value, unit: x.unit, refLow: x.refLow, refHigh: x.refHigh, date: x.date ? new Date(`${x.date}T00:00:00Z`) : null, source: "pdf", note: `from ${imp.fileName}` })),
    }),
    prisma.labImport.update({ where: { id: imp.id }, data: { status: "saved", text: "" } }),
  ]);
  return ok({ ok: true, saved: r.body.rows.length });
}
