-- Household model: any number of people instead of two fixed lanes.
--
-- Before: recipe lines, shopping items and cook-along steps named one of two fixed handles,
-- 'alex' or 'sam' ('both' / 'base' / 'either' = shared). After:
--   RecipeIngredient.forUserId  null = shared base, a user id = that person's own extra
--   ShoppingItem.forUserId      null = for the household, a user id = that person's own extra
--   Step.skill                  skilled | beginner | either (a step attribute, not a person)
--   UserProfile.cookingSkill    skilled | beginner (who can take which steps)
--
-- Old handles map to users deterministically (same rule as legacyOwnerSlugs() in src/lib/household.ts):
--   'alex' -> the user with slug 'alex', else the oldest user whose slug is not 'sam'
--   'sam'  -> the user with slug 'sam',  else the oldest user that is not the 'alex' user
-- (oldest = ORDER BY "createdAt", id). A recipe line whose handle maps to nobody is dropped: that
-- person does not exist, so nobody ate it. Steps: 'alex' -> 'skilled', 'sam' -> 'beginner',
-- anything else -> 'either'. The 'alex' user becomes the skilled cook; everyone else stays 'beginner'.
-- For a two-person household with the seeded slugs, every amount, rule check and lane stays the same.

-- 1. New columns
ALTER TABLE "UserProfile" ADD COLUMN "cookingSkill" TEXT NOT NULL DEFAULT 'beginner';
ALTER TABLE "RecipeIngredient" ADD COLUMN "forUserId" TEXT;
ALTER TABLE "Step" ADD COLUMN "skill" TEXT NOT NULL DEFAULT 'either';
ALTER TABLE "ShoppingItem" ADD COLUMN "forUserId" TEXT;

-- 2. Old handle -> user id
CREATE TEMP TABLE "_legacy_owner" ("handle" TEXT PRIMARY KEY, "userId" TEXT);
INSERT INTO "_legacy_owner" ("handle", "userId")
SELECT 'alex', COALESCE(
  (SELECT "id" FROM "User" WHERE "slug" = 'alex'),
  (SELECT "id" FROM "User" WHERE "slug" <> 'sam' ORDER BY "createdAt", "id" LIMIT 1)
);
INSERT INTO "_legacy_owner" ("handle", "userId")
SELECT 'sam', COALESCE(
  (SELECT "id" FROM "User" WHERE "slug" = 'sam'),
  (SELECT "id" FROM "User" WHERE "id" IS DISTINCT FROM (SELECT "userId" FROM "_legacy_owner" WHERE "handle" = 'alex') ORDER BY "createdAt", "id" LIMIT 1)
);

-- 3. Data
UPDATE "RecipeIngredient" AS ri SET "forUserId" = lo."userId"
FROM "_legacy_owner" AS lo
WHERE ri."component" = lo."handle";
DELETE FROM "RecipeIngredient" WHERE "component" <> 'both' AND "forUserId" IS NULL;

UPDATE "Step" SET "skill" = CASE "who" WHEN 'alex' THEN 'skilled' WHEN 'sam' THEN 'beginner' ELSE 'either' END;

UPDATE "ShoppingItem" AS si SET "forUserId" = lo."userId"
FROM "_legacy_owner" AS lo
WHERE si."forWho" = lo."handle";

UPDATE "UserProfile" AS up SET "cookingSkill" = 'skilled'
FROM "_legacy_owner" AS lo
WHERE lo."handle" = 'alex' AND up."userId" = lo."userId";

DROP TABLE "_legacy_owner";

-- 4. Old columns out, keys in
ALTER TABLE "RecipeIngredient" DROP COLUMN "component";
ALTER TABLE "Step" DROP COLUMN "who";
ALTER TABLE "ShoppingItem" DROP COLUMN "forWho";

CREATE INDEX "RecipeIngredient_forUserId_idx" ON "RecipeIngredient"("forUserId");
ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_forUserId_fkey" FOREIGN KEY ("forUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_forUserId_fkey" FOREIGN KEY ("forUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
