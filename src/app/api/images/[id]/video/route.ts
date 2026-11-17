import { open, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { resolveImageFile } from "@/lib/image-files";
import { currentUser } from "@/lib/auth";
import { isCuid } from "@/lib/api";

export const runtime = "nodejs";

/** Looping hero clip (mp4). Honours Range requests: Safari will not play a video without 206 answers. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await currentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!isCuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const img = await prisma.image.findUnique({ where: { id }, select: { video: true } });
  if (!img?.video) return NextResponse.json({ error: "no video" }, { status: 404 });
  const file = await resolveImageFile(img.video);
  if (!file) return NextResponse.json({ error: "file missing" }, { status: 404 });
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return NextResponse.json({ error: "file missing" }, { status: 404 });
  }
  const base = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=31536000, immutable" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  let start = 0;
  let end = size - 1;
  if (m) {
    if (m[1] === "" && m[2] !== "") start = Math.max(0, size - Number(m[2]));
    else {
      start = Number(m[1] || 0);
      if (m[2] !== "") end = Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) return new NextResponse(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  const len = end - start + 1;
  const fh = await open(file, "r");
  try {
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    return new NextResponse(new Uint8Array(buf), {
      status: m ? 206 : 200,
      headers: { ...base, "Content-Length": String(len), ...(m ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}) },
    });
  } finally {
    await fh.close();
  }
}
