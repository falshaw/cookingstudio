import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { isCuid } from "@/lib/api";

// ALLOWLIST of shared kitchen job types (recipes, plans, feed, guide cards) — readable by both.
// Every other type (report, photo, lab-pdf and any type added later) is owner-only: someone else's
// id answers 404, exactly like a missing one.
const SHARED_JOBS = new Set(["teach", "import-url", "plan", "feed", "cards"]);

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!isCuid(id)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  const row = await prisma.job.findUnique({ where: { id }, select: { id: true, type: true, status: true, log: true, result: true, error: true, createdAt: true, updatedAt: true, userId: true, input: true } });
  // A report is about input.userId; an older report may have been started by someone else.
  const subject = row?.type === "report" ? (row.input as { userId?: string } | null)?.userId : row?.userId;
  if (!row || (!SHARED_JOBS.has(row.type) && (row.userId !== me.id || subject !== me.id))) return NextResponse.json({ error: "not found" }, { status: 404 });
  // userId and input (the photo, the import id) never go back to the browser.
  const { userId: _owner, input: _input, ...job } = row;
  const ahead = job.status === "queued" ? await prisma.job.count({ where: { status: { in: ["queued", "running"] }, createdAt: { lt: job.createdAt } } }) : 0;
  return NextResponse.json({ ...job, ahead });
}
