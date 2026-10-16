-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- AlterTable
ALTER TABLE "CountSession" ADD COLUMN "customerId" TEXT;
ALTER TABLE "CountSession" ADD COLUMN "customerName" TEXT;

-- AlterTable
ALTER TABLE "CountRecord" ADD COLUMN "customerId" TEXT;
ALTER TABLE "CountRecord" ADD COLUMN "customerName" TEXT;

-- CreateIndex
CREATE INDEX "CountRecord_customerId_idx" ON "CountRecord"("customerId");
