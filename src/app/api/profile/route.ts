import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { ok, withUser } from "@/lib/api";

const list = z.array(z.string().trim().min(1).max(60)).max(60);
const optNum = z.number().finite().min(0).max(10000).nullable();

const Body = z.object({
  vegetarian: z.boolean(),
  vegBreakfastAllowed: list,
  avoidFoods: list,
  likedFoods: list,
  healthTargets: z.string().max(2000),
  goals: z.string().max(2000),
  maxCookMinutes: optNum,
  maxLunchMinutes: optNum,
  maxNetCarbsPerMeal: optNum,
  minProteinPerMeal: optNum,
  noAddedSugar: z.boolean(),
  noRefinedStarch: z.boolean(),
  noAlcohol: z.boolean(),
  omega3MinPerWeek: z.number().int().min(0).max(21).nullable(),
  omega3MaxPerWeek: z.number().int().min(0).max(21).nullable(),
  redMeatMaxPerWeek: z.number().int().min(0).max(21).nullable().default(null),
  dailyKcal: z.number().int().min(0).max(10000).nullable(),
  dailyProtein: z.number().int().min(0).max(1000).nullable(),
  dailyNetCarbs: z.number().int().min(0).max(1000).nullable(),
  portionFactor: z.number().min(0.25).max(3),
  practiceGoalPerWeek: z.number().int().min(0).max(21),
  referenceGroup: z.enum(["general", "male", "female"]).default("general"),
  weightLostKg: z.number().min(-100).max(200).nullable(),
  nextLabDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  tasteOverrides: z.object({ likes: list, dislikes: list }).optional(),
});

// Each person edits ONLY their own profile (health targets are personal).
export async function PUT(req: Request) {
  const r = await withUser(req, Body);
  if (r.error) return r.error;
  const { nextLabDate, tasteOverrides, ...rest } = r.body;
  const data = { ...rest, nextLabDate: nextLabDate ? new Date(`${nextLabDate}T00:00:00Z`) : null, ...(tasteOverrides ? { tasteOverrides } : {}) };
  await prisma.userProfile.upsert({ where: { userId: r.user.id }, create: { userId: r.user.id, ...data }, update: data });
  return ok();
}
