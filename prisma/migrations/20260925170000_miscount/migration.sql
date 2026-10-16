-- CreateTable
CREATE TABLE "Miscount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "farmId" TEXT NOT NULL,
    "farmName" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "sizeName" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "gradeName" TEXT NOT NULL,
    "counterId" TEXT NOT NULL,
    "counterName" TEXT NOT NULL,
    "counterRole" TEXT NOT NULL,
    "timestampLocal" TEXT NOT NULL,
    "timestampUtc" DATETIME NOT NULL,
    "clientSyncId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Miscount_clientSyncId_key" ON "Miscount"("clientSyncId");

-- CreateIndex
CREATE INDEX "Miscount_timestampUtc_idx" ON "Miscount"("timestampUtc");
