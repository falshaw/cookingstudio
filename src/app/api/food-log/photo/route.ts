import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { bad, ok, uploadTooLarge, withUser } from "@/lib/api";
import { ollamaUp } from "@/lib/ollama";

// Photo food log: the image goes ONLY to the local Ollama vision model (OLLAMA_VISION_MODEL) via a
// background job; the job drops the image once read. The user confirms every item before logging.
const Body = z.object({ image: z.string().min(100).max(6_000_000).regex(/^[A-Za-z0-9+/=]+$/, "base64 image expected") });

export async function POST(req: Request) {
  const big = uploadTooLarge(req, 6.5 * 1024 * 1024);
  if (big) return big;
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  if (!(await ollamaUp())) return bad("The local AI (Ollama) is not running — photo logging is off. Log by hand below.", 409);
  const job = await prisma.job.create({ data: { userId: r.user.id, type: "photo", input: { image: r.body.image } } });
  return ok({ ok: true, id: job.id });
}
