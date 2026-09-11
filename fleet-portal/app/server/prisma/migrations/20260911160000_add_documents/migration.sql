-- CreateTable
CREATE TABLE "Address" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "code" TEXT,
    "fullAddress" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AddressRate" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "addressId" INTEGER NOT NULL,
    "pricePerKg" REAL NOT NULL,
    "effectiveFrom" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AddressRate_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrgProfile" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "inn" TEXT NOT NULL,
    "kpp" TEXT,
    "legalAddress" TEXT NOT NULL,
    "phone" TEXT,
    "bankName" TEXT,
    "bankAccount" TEXT,
    "bik" TEXT,
    "corrAccount" TEXT,
    "dispatchPoint" TEXT,
    "contractNumber" TEXT,
    "contractDate" DATETIME,
    "contractIgk" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "periodFrom" DATETIME NOT NULL,
    "periodTo" DATETIME NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "totalMassKg" REAL NOT NULL,
    "totalCost" REAL NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "importBatchId" INTEGER NOT NULL,
    "date" DATETIME NOT NULL,
    "addressId" INTEGER NOT NULL,
    "truckPlate" TEXT NOT NULL,
    "distanceKm" REAL NOT NULL,
    "massKg" REAL NOT NULL,
    "ratePerKg" REAL NOT NULL,
    "cost" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Delivery_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Delivery_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MonthClosing" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "yearMonth" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATETIME NOT NULL,
    "finalActNumber" INTEGER NOT NULL,
    "finalActDate" DATETIME NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Address_fullAddress_key" ON "Address"("fullAddress");

-- CreateIndex
CREATE INDEX "Address_city_idx" ON "Address"("city");

-- CreateIndex
CREATE INDEX "AddressRate_addressId_effectiveFrom_idx" ON "AddressRate"("addressId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "OrgProfile_role_key" ON "OrgProfile"("role");

-- CreateIndex
CREATE INDEX "ImportBatch_periodFrom_periodTo_idx" ON "ImportBatch"("periodFrom", "periodTo");

-- CreateIndex
CREATE INDEX "Delivery_date_idx" ON "Delivery"("date");

-- CreateIndex
CREATE INDEX "Delivery_truckPlate_date_idx" ON "Delivery"("truckPlate", "date");

-- CreateIndex
CREATE UNIQUE INDEX "MonthClosing_yearMonth_key" ON "MonthClosing"("yearMonth");
