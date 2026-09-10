-- CreateTable
CREATE TABLE "AdminAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "pinHash" TEXT,
    "pinKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CounterAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountLabel" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "pinKey" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "access" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Farm" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TreeSize" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TreeGrade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CountSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "farmId" TEXT,
    "farmName" TEXT,
    "startedAt" DATETIME NOT NULL,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CountRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "timestampLocal" TEXT NOT NULL,
    "timestampUtc" DATETIME NOT NULL,
    "action" TEXT NOT NULL,
    "farmId" TEXT,
    "farmName" TEXT,
    "sizeId" TEXT NOT NULL,
    "sizeName" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "gradeName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "sessionId" TEXT NOT NULL,
    "clientSyncId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncedAt" DATETIME,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "correctionNote" TEXT,
    "correctedAt" DATETIME,
    CONSTRAINT "CountRecord_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CountSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StartingInventory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "farmId" TEXT NOT NULL,
    "sizeId" TEXT NOT NULL,
    "gradeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StartingInventory_farmId_fkey" FOREIGN KEY ("farmId") REFERENCES "Farm" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StartingInventory_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "TreeSize" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StartingInventory_gradeId_fkey" FOREIGN KEY ("gradeId") REFERENCES "TreeGrade" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'default',
    "setupLocked" BOOLEAN NOT NULL DEFAULT false,
    "excelApiKeyHash" TEXT,
    "excelEnabled" BOOLEAN NOT NULL DEFAULT false,
    "soundEnabled" BOOLEAN NOT NULL DEFAULT true,
    "vibrationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checklistJson" TEXT NOT NULL DEFAULT '{}',
    "checklistDismissed" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccount_email_key" ON "AdminAccount"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AdminAccount_pinKey_key" ON "AdminAccount"("pinKey");

-- CreateIndex
CREATE UNIQUE INDEX "CounterAccount_pinKey_key" ON "CounterAccount"("pinKey");

-- CreateIndex
CREATE UNIQUE INDEX "CountRecord_clientSyncId_key" ON "CountRecord"("clientSyncId");

-- CreateIndex
CREATE UNIQUE INDEX "StartingInventory_farmId_sizeId_gradeId_key" ON "StartingInventory"("farmId", "sizeId", "gradeId");

-- CreateIndex
CREATE UNIQUE INDEX "LoginAttempt_scope_key" ON "LoginAttempt"("scope");

-- CreateIndex
CREATE INDEX "CountRecord_action_timestampUtc_idx" ON "CountRecord"("action", "timestampUtc");

-- CreateIndex
CREATE INDEX "CountRecord_farmId_idx" ON "CountRecord"("farmId");

-- CreateIndex
CREATE INDEX "CountRecord_sessionId_idx" ON "CountRecord"("sessionId");
