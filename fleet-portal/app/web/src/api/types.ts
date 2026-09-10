export type Role = "ADMIN" | "DISPATCHER" | "DRIVER";
export type TripStatus = "ASSIGNED" | "IN_PROGRESS" | "DONE" | "CANCELLED";

export const TRIP_STATUS_LABELS: Record<TripStatus, string> = {
  ASSIGNED: "Назначен",
  IN_PROGRESS: "В пути",
  DONE: "Завершён",
  CANCELLED: "Отменён",
};

export interface CurrentUser {
  id: number;
  email: string;
  role: Role;
  driverId: number | null;
  driverName?: string | null;
}

export interface Truck {
  id: number;
  name: string;
  plateNumber: string;
  capacityTons: number | null;
  normConsumptionMin: number | null;
  normConsumptionMax: number | null;
  serviceIntervalKm: number | null;
  serviceIntervalDays: number | null;
  lastServiceDate: string | null;
  lastServiceOdometer: number | null;
  insuranceExpiryDate: string | null;
  inspectionExpiryDate: string | null;
  isActive: boolean;
}

export interface Driver {
  id: number;
  fullName: string;
  phone: string | null;
  isActive: boolean;
  loginEmail: string | null;
}

export interface FuelType {
  id: number;
  name: string;
  isActive: boolean;
}

export interface FuelLot {
  id: number;
  fuelTypeId: number;
  fuelType?: FuelType;
  date: string;
  litersIn: number;
  litersRemaining: number;
  pricePerLiter: number;
  totalAmount: number;
  supplier: string | null;
  comment: string | null;
}

export interface FuelWithdrawal {
  id: number;
  fuelTypeId: number;
  fuelType?: FuelType;
  date: string;
  liters: number;
  isPersonal: boolean;
  truckId: number | null;
  truck?: Truck;
  odometer: number | null;
  personalComment: string | null;
  totalCost: number;
  tripId: number | null;
}

export interface FuelBalanceRow {
  fuelTypeId: number;
  fuelTypeName: string;
  liters: number;
  value: number;
}

export interface ConsumptionRow {
  key: number | "personal";
  label: string;
  companyLiters: number;
  companyCost: number;
  personalLiters: number;
  personalCost: number;
  count: number;
}

export interface ConsumptionReport {
  rows: ConsumptionRow[];
  totals: {
    companyLiters: number;
    companyCost: number;
    personalLiters: number;
    personalCost: number;
  };
}

export interface InflowRow {
  fuelTypeId: number;
  fuelTypeName: string;
  liters: number;
  cost: number;
  count: number;
}

export interface InflowReport {
  rows: InflowRow[];
  totals: { liters: number; cost: number };
}

export interface Per100KmReport {
  insufficientData: boolean;
  totalLiters: number;
  distanceKm?: number;
  litersPer100Km?: number;
  odometerReadingsCount?: number;
  norm: { min: number | null; max: number | null };
}

export type MaintenanceType = "SERVICE" | "REPAIR";

export interface MaintenancePart {
  id: number;
  name: string;
  cost: number;
}

export interface MaintenanceRecord {
  id: number;
  truckId: number;
  truck?: Truck;
  type: MaintenanceType;
  date: string;
  odometer: number;
  description: string | null;
  totalCost: number;
  parts: MaintenancePart[];
}

export interface UpcomingService {
  truckId: number;
  truckName: string;
  plateNumber: string;
  currentOdometer: number | null;
  lastServiceDate: string | null;
  lastServiceOdometer: number | null;
  dueOdometer: number | null;
  remainingKm: number | null;
  dueDate: string | null;
  remainingDays: number | null;
  overdue: boolean;
}

export interface MaintenanceCostRow {
  key: string;
  label: string;
  serviceCost: number;
  repairCost: number;
  totalCost: number;
  count: number;
}

export interface MaintenanceCostReport {
  rows: MaintenanceCostRow[];
  totals: { serviceCost: number; repairCost: number; totalCost: number };
}

export interface Trip {
  id: number;
  date: string;
  driverId: number;
  driver?: Driver;
  truckId: number;
  truck?: Truck;
  routeFrom: string;
  routeTo: string;
  cargoDescription: string | null;
  status: TripStatus;
  notes: string | null;
}
