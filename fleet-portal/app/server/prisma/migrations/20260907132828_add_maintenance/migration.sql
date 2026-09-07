-- AlterTable
ALTER TABLE "Truck" ADD COLUMN "lastServiceDate" DATETIME;
ALTER TABLE "Truck" ADD COLUMN "lastServiceOdometer" REAL;
ALTER TABLE "Truck" ADD COLUMN "serviceIntervalDays" INTEGER;
ALTER TABLE "Truck" ADD COLUMN "serviceIntervalKm" REAL;

-- CreateTable
CREATE TABLE "MaintenanceRecord" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "truckId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "odometer" REAL NOT NULL,
    "description" TEXT,
    "totalCost" REAL NOT NULL,
    "createdBy" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MaintenanceRecord_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenancePart" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "recordId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "cost" REAL NOT NULL,
    CONSTRAINT "MaintenancePart_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MaintenanceRecord" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MaintenanceRecord_truckId_date_idx" ON "MaintenanceRecord"("truckId", "date");

-- CreateIndex
CREATE INDEX "MaintenanceRecord_type_date_idx" ON "MaintenanceRecord"("type", "date");
