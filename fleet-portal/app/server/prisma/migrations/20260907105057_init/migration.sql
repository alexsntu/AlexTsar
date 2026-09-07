-- CreateTable
CREATE TABLE "User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "driverId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Truck" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FuelType" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "FuelLot" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fuelTypeId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "litersIn" REAL NOT NULL,
    "litersRemaining" REAL NOT NULL,
    "pricePerLiter" REAL NOT NULL,
    "totalAmount" REAL NOT NULL,
    "supplier" TEXT,
    "comment" TEXT,
    "createdBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FuelLot_fuelTypeId_fkey" FOREIGN KEY ("fuelTypeId") REFERENCES "FuelType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FuelWithdrawal" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "fuelTypeId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "liters" REAL NOT NULL,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "truckId" INTEGER,
    "odometer" REAL,
    "personalComment" TEXT,
    "totalCost" REAL NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tripId" INTEGER,
    CONSTRAINT "FuelWithdrawal_fuelTypeId_fkey" FOREIGN KEY ("fuelTypeId") REFERENCES "FuelType" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelWithdrawal_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FuelWithdrawal_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FuelWithdrawalLotUsage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "withdrawalId" INTEGER NOT NULL,
    "lotId" INTEGER NOT NULL,
    "litersUsed" REAL NOT NULL,
    "pricePerLiterAtUse" REAL NOT NULL,
    CONSTRAINT "FuelWithdrawalLotUsage_withdrawalId_fkey" FOREIGN KEY ("withdrawalId") REFERENCES "FuelWithdrawal" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "FuelWithdrawalLotUsage_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "FuelLot" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Trip" (
    "date" DATETIME NOT NULL,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "driverId" INTEGER NOT NULL,
    "truckId" INTEGER NOT NULL,
    "routeFrom" TEXT NOT NULL,
    "routeTo" TEXT NOT NULL,
    "cargoDescription" TEXT,
    "cargoJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "createdBy" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Trip_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_driverId_key" ON "User"("driverId");

-- CreateIndex
CREATE UNIQUE INDEX "FuelType_name_key" ON "FuelType"("name");

-- CreateIndex
CREATE INDEX "FuelLot_fuelTypeId_date_idx" ON "FuelLot"("fuelTypeId", "date");

-- CreateIndex
CREATE INDEX "FuelWithdrawal_date_fuelTypeId_truckId_idx" ON "FuelWithdrawal"("date", "fuelTypeId", "truckId");

-- CreateIndex
CREATE INDEX "Trip_driverId_status_date_idx" ON "Trip"("driverId", "status", "date");
