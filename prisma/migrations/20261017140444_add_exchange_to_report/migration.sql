-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "exchangeId" TEXT;

-- CreateIndex
CREATE INDEX "Report_exchangeId_idx" ON "Report"("exchangeId");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE SET NULL ON UPDATE CASCADE;

