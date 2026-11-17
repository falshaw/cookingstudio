import { z } from "zod";
import { ok, withUser } from "@/lib/api";
import { setSetting } from "@/lib/feed";

export async function POST(req: Request) {
  const r = await withUser(req, z.object({ feedPerWeek: z.number().int().min(0).max(14) }));
  if (r.error) return r.error;
  await setSetting("feed.perWeek", r.body.feedPerWeek);
  return ok();
}
