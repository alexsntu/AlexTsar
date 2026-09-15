/*
  Warnings:

  - You are about to drop the `BonusGroup` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "BonusGroup";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Royalty" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RoyaltyCondition" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "royaltyId" INTEGER NOT NULL,
    "percent" REAL NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "trucksJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoyaltyCondition_royaltyId_fkey" FOREIGN KEY ("royaltyId") REFERENCES "Royalty" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RoyaltyCondition_royaltyId_idx" ON "RoyaltyCondition"("royaltyId");
