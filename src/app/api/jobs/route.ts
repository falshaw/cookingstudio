import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, withUser } from "@/lib/api";
import { weekStart } from "@/lib/utils";

const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("teach"), dish: z.string().min(2).max(200), level: z.number().int().min(1).max(8).optional() }),
  z.object({ type: z.literal("import-url"), url: z.string().url().max(2000) }),
  z.object({ type: z.literal("plan"), weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  z.object({ type: z.literal("feed") }),
  // Health data: the report is always the caller's own — no target user in the body.
  z.object({ type: z.literal("report") }),
]);

export async function POST(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const b = r.body;
  const busy = await prisma.job.count({ where: { status: { in: ["queued", "running"] } } });
  if (busy >= 10) return bad("The kitchen AI already has 10 jobs waiting — try again later.", 429);
  let input: Record<string, unknown>;
  if (b.type === "teach") input = { dish: b.dish, level: b.level };
  else if (b.type === "import-url") input = { url: b.url };
  else if (b.type === "plan") input = { weekStart: (b.weekStart ? new Date(`${b.weekStart}T00:00:00Z`) : weekStart(new Date())).toISOString() };
  else if (b.type === "report") {
    const { ollamaUp } = await import("@/lib/ollama");
    if (!(await ollamaUp())) return bad("The local AI (Ollama) is not running — the report shows numbers only.", 409);
    input = { userId: r.user.id };
  } else input = { manual: true };
  const job = await prisma.job.create({ data: { userId: r.user.id, type: b.type, input: input as object } });
  return ok({ ok: true, id: job.id, queuedAhead: busy });
}
