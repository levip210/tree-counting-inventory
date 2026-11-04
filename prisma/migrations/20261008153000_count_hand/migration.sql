-- AlterTable
ALTER TABLE "AdminAccount" ADD COLUMN "countHand" TEXT NOT NULL DEFAULT 'right';

-- AlterTable
ALTER TABLE "CounterAccount" ADD COLUMN "countHand" TEXT NOT NULL DEFAULT 'right';
