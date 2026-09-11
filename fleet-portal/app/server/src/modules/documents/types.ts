export interface ParsedDeliveryRow {
  /** Номер строки в исходном листе — только для сообщений об ошибках. */
  rowNumber: number;
  date: Date;
  addressText: string;
  truckPlate: string;
  distanceKm: number;
  massKg: number;
  /** Стоимость доставки, как указана в присланном файле (колонка K). */
  fileCost: number;
}

export interface ImportRowError {
  rowNumber: number;
  date: string;
  addressText: string;
  message: string;
}

export interface ValidatedRow extends ParsedDeliveryRow {
  addressId: number;
  ratePerKg: number;
  expectedCost: number;
}
