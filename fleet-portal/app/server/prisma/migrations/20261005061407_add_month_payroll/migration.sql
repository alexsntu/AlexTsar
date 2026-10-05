-- CreateTable
CREATE TABLE "MonthPayroll" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "yearMonth" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "updatedBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "MonthPayroll_yearMonth_key" ON "MonthPayroll"("yearMonth");
