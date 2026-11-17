import { bad, ok, withScoped } from "@/lib/api";
import { searchNutrition } from "@/lib/nutrition-search";

// USDA SR Legacy lookup for "log an ingredient by grams". Public reference data, per 100 g; no user data.
export async function GET(req: Request) {
  const r = await withScoped(req, null, ["food-log:read", "food-log:write"]);
  if (r.error) return r.error;
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  if (q.trim().length < 2) return bad("type at least 2 letters");
  return ok({ results: await searchNutrition(q) });
}
