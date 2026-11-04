-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "lastBackupAt" DATETIME;

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "lastBackupOk" BOOLEAN;

-- AlterTable
ALTER TABLE "AppSettings" ADD COLUMN "lastBackupError" TEXT;
