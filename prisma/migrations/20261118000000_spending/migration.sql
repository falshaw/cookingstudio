-- Grocery spending (receipts). Written idempotently: a database that was created with `prisma db push`
-- after the spending feature shipped already has these tables, one created before it does not. Both are
-- baselined at 0_init by prisma/migrate.ts, so this migration has to work on either.

CREATE TABLE IF NOT EXISTS "Purchase" (
    "id" TEXT NOT NULL,
    "store" TEXT NOT NULL,
    "boughtOn" TIMESTAMP(3) NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PurchaseItem" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ingredientId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'food',
    "price" DOUBLE PRECISION NOT NULL,
    "grams" DOUBLE PRECISION,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Purchase_boughtOn_idx" ON "Purchase"("boughtOn");
CREATE INDEX IF NOT EXISTS "PurchaseItem_purchaseId_idx" ON "PurchaseItem"("purchaseId");
CREATE INDEX IF NOT EXISTS "PurchaseItem_ingredientId_idx" ON "PurchaseItem"("ingredientId");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseItem_purchaseId_fkey') THEN
    ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseItem_ingredientId_fkey') THEN
    ALTER TABLE "PurchaseItem" ADD CONSTRAINT "PurchaseItem_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
