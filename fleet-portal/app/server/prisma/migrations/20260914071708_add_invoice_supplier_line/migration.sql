/*
  Warnings:

  - Made the column `valueRemaining` on table `FuelLot` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "OrgProfile" ADD COLUMN "invoiceSupplierLine" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_FuelLot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fuelTypeId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "litersIn" REAL NOT NULL,
    "litersRemaining" REAL NOT NULL,
    "pricePerLiter" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "valueRemaining" REAL NOT NULL,
    "supplier" TEXT,
    "comment" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FuelLot_fuelTypeId_fkey" FOREIGN KEY ("fuelTypeId") REFERENCES "FuelType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_FuelLot" ("comment", "createdAt", "createdBy", "date", "fuelTypeId", "id", "litersIn", "litersRemaining", "pricePerLiter", "supplier", "totalAmount", "valueRemaining") SELECT "comment", "createdAt", "createdBy", "date", "fuelTypeId", "id", "litersIn", "litersRemaining", "pricePerLiter", "supplier", "totalAmount", "valueRemaining" FROM "FuelLot";
DROP TABLE "FuelLot";
ALTER TABLE "new_FuelLot" RENAME TO "FuelLot";
CREATE INDEX "FuelLot_fuelTypeId_date_idx" ON "FuelLot"("fuelTypeId", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
