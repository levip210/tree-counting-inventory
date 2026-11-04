-- Additive nullable columns on CountRecord.
-- Existing rows stay as they are. This file does not rewrite quantities.
ALTER TABLE "CountRecord" ADD COLUMN "adjustmentDirection" TEXT;
ALTER TABLE "CountRecord" ADD COLUMN "adjustedByAdminId" TEXT;
ALTER TABLE "CountRecord" ADD COLUMN "adjustedByName" TEXT;
