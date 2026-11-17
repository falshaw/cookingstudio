import { prisma } from "@/lib/prisma";
import { bad, ok, uploadTooLarge } from "@/lib/api";
import { currentUser } from "@/lib/auth";
import { parseGlucoseCsv } from "@/lib/glucose";
import { logInfo, logWarn, requestIdOf } from "@/lib/log";

export const runtime = "nodejs";

// CGM CSV import (FreeStyle Libre / Dexcom Clarity) into the uploader's own readings. Local only.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return bad("Unauthorized", 401);
  const big = uploadTooLarge(req, 8 * 1024 * 1024);
  if (big) return big;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return bad("no file");
  let parsed;
  try {
    parsed = parseGlucoseCsv(await file.text());
  } catch (e) {
    logWarn("glucose csv rejected", { requestId: requestIdOf(req), err: e });
    return bad(e instanceof Error ? e.message : "could not read the CSV", 422);
  }
  if (!parsed.readings.length) return bad("no glucose readings found in the file", 422);
  let added = 0;
  for (let i = 0; i < parsed.readings.length; i += 1000) {
    const r = await prisma.glucoseReading.createMany({ data: parsed.readings.slice(i, i + 1000).map((x) => ({ userId: user.id, at: x.at, mgdl: x.mgdl, source: parsed.source })), skipDuplicates: true });
    added += r.count;
  }
  logInfo("glucose imported", { requestId: requestIdOf(req), source: parsed.source, rows: parsed.readings.length, added });
  return ok({ ok: true, source: parsed.source, read: parsed.readings.length, added, skipped: parsed.skipped });
}

export async function DELETE() {
  const user = await currentUser();
  if (!user) return bad("Unauthorized", 401);
  const r = await prisma.glucoseReading.deleteMany({ where: { userId: user.id } });
  return ok({ ok: true, deleted: r.count });
}
