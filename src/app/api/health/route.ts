import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";

export const dynamic = "force-dynamic";

// Liveness + DB readiness: 503 when Postgres is unreachable (Docker marks the container unhealthy).
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ok", app: "cookingstudio", db: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    logError("health: database unreachable", { err });
    return NextResponse.json({ status: "error", app: "cookingstudio", db: "unreachable" }, { status: 503 });
  }
}
