-- AlterTable
ALTER TABLE "User" ADD COLUMN     "bio" VARCHAR(280),
ADD COLUMN     "interests" "CardCategory"[] DEFAULT ARRAY[]::"CardCategory"[],
ADD COLUMN     "offers" "CardCategory"[] DEFAULT ARRAY[]::"CardCategory"[],
ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Rating" ADD COLUMN     "commentModerated" BOOLEAN NOT NULL DEFAULT false;

