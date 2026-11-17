import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { contentType, resolveImageFile, resolveThumbFile } from "@/lib/image-files";
import { currentUser } from "@/lib/auth";
import { isCuid } from "@/lib/api";

export const runtime = "nodejs";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!isCuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const img = await prisma.image.findUnique({ where: { id }, select: { status: true, file: true } });
  if (!img || img.status !== "done" || !img.file) return NextResponse.json({ status: img?.status ?? "missing" }, { status: 404 });
  // ?w=thumb → the pre-made 480 px WebP (`<name>.thumb.webp`, made by scripts/make-thumbs.py), looked up in
  // the images volume and the seed folder; falls back to the original when none exists yet.
  const thumb = new URL(req.url).searchParams.get("w") === "thumb" ? await resolveThumbFile(img.file) : null;
  const file = thumb ?? (await resolveImageFile(img.file));
  if (!file) return NextResponse.json({ error: "file missing" }, { status: 404 });
  try {
    const buf = await readFile(file);
    return new NextResponse(new Uint8Array(buf), {
      headers: { "Content-Type": contentType(file), "Cache-Control": "private, max-age=31536000, immutable" },
    });
  } catch {
    return NextResponse.json({ error: "file missing" }, { status: 404 });
  }
}
