import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, withUser } from "@/lib/api";

const Body = z.object({ slug: z.string().min(1).max(60), have: z.boolean() });

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  await prisma.equipment.update({ where: { slug: r.body.slug }, data: { have: r.body.have } });
  return ok();
}
