-- AlterEnum
BEGIN;
CREATE TYPE "CardCategory_new" AS ENUM ('home_repairs', 'cleaning', 'moving', 'garden', 'peoplecare', 'petcare', 'health_support', 'learning', 'workshops', 'digital', 'cooking', 'transport', 'events', 'sports', 'creative_projects');
ALTER TABLE "Card" ALTER COLUMN "category" TYPE "CardCategory_new" USING ("category"::text::"CardCategory_new");
ALTER TYPE "CardCategory" RENAME TO "CardCategory_old";
ALTER TYPE "CardCategory_new" RENAME TO "CardCategory";
DROP TYPE "public"."CardCategory_old";
COMMIT;

