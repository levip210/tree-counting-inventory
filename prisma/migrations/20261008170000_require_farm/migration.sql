-- AlterTable
ALTER TABLE "TreeSize" ADD COLUMN "requireFarm" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TreeGrade" ADD COLUMN "requireFarm" BOOLEAN NOT NULL DEFAULT true;
