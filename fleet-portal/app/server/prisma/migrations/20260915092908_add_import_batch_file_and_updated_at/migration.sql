/*
  Warnings:

  - Added the required column `updatedAt` to the `ImportBatch` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ImportBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "periodFrom" DATETIME NOT NULL,
    "periodTo" DATETIME NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "totalMassKg" REAL NOT NULL,
    "totalCost" REAL NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "fileData" BLOB
);
INSERT INTO "new_ImportBatch" ("createdAt", "createdBy", "id", "periodFrom", "periodTo", "rowCount", "sourceFileName", "totalCost", "totalMassKg", "updatedAt") SELECT "createdAt", "createdBy", "id", "periodFrom", "periodTo", "rowCount", "sourceFileName", "totalCost", "totalMassKg", "createdAt" FROM "ImportBatch";
DROP TABLE "ImportBatch";
ALTER TABLE "new_ImportBatch" RENAME TO "ImportBatch";
CREATE INDEX "ImportBatch_periodFrom_periodTo_idx" ON "ImportBatch"("periodFrom", "periodTo");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
