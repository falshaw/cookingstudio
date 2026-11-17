import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { bad, ok, uploadTooLarge } from "@/lib/api";
import { logWarn, requestIdOf } from "@/lib/log";
import { currentUser } from "@/lib/auth";
import { pdfToText } from "@/lib/worker";

export const runtime = "nodejs";

// PDF → pdftotext in the container → background job (the local model suggests values) → the user
// confirms every value before anything is saved. Always into the uploader's own tracker.
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return bad("Unauthorized", 401);
  const big = uploadTooLarge(req, 10.5 * 1024 * 1024);
  if (big) return big;
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return bad("no file");
  if (file.size > 10 * 1024 * 1024) return bad("PDF too large (max 10 MB)");
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== "%PDF-") return bad("not a PDF");
  const tmp = path.join("/tmp", `${randomUUID()}.pdf`);
  let text = "";
  try {
    await writeFile(tmp, buf);
    text = await pdfToText(tmp);
  } catch (e) {
    logWarn("lab pdf unreadable", { requestId: requestIdOf(req), err: e });
    return bad("could not read the PDF (damaged or password-protected?)", 422);
  } finally {
    await unlink(tmp).catch(() => {});
  }
  if (text.trim().length < 30) return bad("the PDF has no text layer (scanned image?) — enter the values by hand", 422);
  const imp = await prisma.labImport.create({ data: { userId: user.id, fileName: file.name.slice(0, 120), text } });
  await prisma.job.create({ data: { userId: user.id, type: "lab-pdf", input: { importId: imp.id } } });
  return ok({ ok: true, id: imp.id });
}
