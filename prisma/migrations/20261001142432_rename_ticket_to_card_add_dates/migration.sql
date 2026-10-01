/*
  Warnings:

  - You are about to drop the column `ticketId` on the `Exchange` table. All the data in the column will be lost.
  - You are about to drop the column `ticketId` on the `Report` table. All the data in the column will be lost.
  - You are about to drop the `Ticket` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `cardId` to the `Exchange` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CardType" AS ENUM ('request', 'offer');

-- CreateEnum
CREATE TYPE "CardCategory" AS ENUM ('home', 'care', 'digital', 'community', 'learning');

-- CreateEnum
CREATE TYPE "CardStatus" AS ENUM ('active', 'completed', 'reported');

-- DropForeignKey
ALTER TABLE "Exchange" DROP CONSTRAINT "Exchange_ticketId_fkey";

-- DropForeignKey
ALTER TABLE "Report" DROP CONSTRAINT "Report_ticketId_fkey";

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_authorId_fkey";

-- DropIndex
DROP INDEX "Exchange_ticketId_idx";

-- DropIndex
DROP INDEX "Report_ticketId_idx";

-- AlterTable
ALTER TABLE "Exchange" DROP COLUMN "ticketId",
ADD COLUMN     "cardId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Report" DROP COLUMN "ticketId",
ADD COLUMN     "cardId" TEXT;

-- DropTable
DROP TABLE "Ticket";

-- DropEnum
DROP TYPE "TicketCategory";

-- DropEnum
DROP TYPE "TicketStatus";

-- DropEnum
DROP TYPE "TicketType";

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "type" "CardType" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "category" "CardCategory" NOT NULL,
    "hours" INTEGER NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "status" "CardStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Card_authorId_idx" ON "Card"("authorId");

-- CreateIndex
CREATE INDEX "Card_status_lat_lng_idx" ON "Card"("status", "lat", "lng");

-- CreateIndex
CREATE INDEX "Card_category_status_idx" ON "Card"("category", "status");

-- CreateIndex
CREATE INDEX "Exchange_cardId_idx" ON "Exchange"("cardId");

-- CreateIndex
CREATE INDEX "Report_cardId_idx" ON "Report"("cardId");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exchange" ADD CONSTRAINT "Exchange_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
