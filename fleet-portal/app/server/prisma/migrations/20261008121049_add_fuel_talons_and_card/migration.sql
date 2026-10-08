-- CreateTable
CREATE TABLE "FuelTalonLot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fuelTypeId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "nominalLiters" INTEGER NOT NULL,
    "countIn" INTEGER NOT NULL,
    "countRemaining" INTEGER NOT NULL,
    "pricePerTalon" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "valueRemaining" REAL NOT NULL,
    "supplier" TEXT,
    "comment" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FuelTalonLot_fuelTypeId_fkey" FOREIGN KEY ("fuelTypeId") REFERENCES "FuelType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FuelTalonUsage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "withdrawalId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "countUsed" INTEGER NOT NULL,
    "pricePerTalonAtUse" REAL NOT NULL,
    "cost" REAL NOT NULL,
    CONSTRAINT "FuelTalonUsage_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "FuelWithdrawal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelTalonUsage_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "FuelTalonLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Источник заправки (склад / талоны / топливная карта) и его реквизиты.
-- Обычный ADD COLUMN вместо пересоздания таблицы: существующие заправки
-- остаются на месте и получают source = 'TANK'.
ALTER TABLE "FuelWithdrawal" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'TANK';
ALTER TABLE "FuelWithdrawal" ADD COLUMN "talonNominal" INTEGER;
ALTER TABLE "FuelWithdrawal" ADD COLUMN "talonCount" INTEGER;
ALTER TABLE "FuelWithdrawal" ADD COLUMN "pricePerLiter" REAL;

-- CreateIndex
CREATE INDEX "FuelTalonLot_fuelTypeId_nominalLiters_date_idx" ON "FuelTalonLot"("fuelTypeId", "nominalLiters", "date");
