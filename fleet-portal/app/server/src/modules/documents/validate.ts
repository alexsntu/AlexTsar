import type { Address, AddressRate } from "@prisma/client";
import { extractAddressCode } from "./importParser.js";
import type { ImportRowError, ParsedDeliveryRow, ValidatedRow } from "./types.js";

// Допуск на погрешность плавающей точки при сравнении рассчитанной и
// присланной стоимости — не логическая "погрешность тарифа", а просто
// защита от 12622.499999999998 vs 12622.5.
const COST_TOLERANCE = 0.01;

export interface ValidationResult {
  valid: boolean;
  errors: ImportRowError[];
  validated: ValidatedRow[];
}

/**
 * Сверяет строки присланного файла со справочником адресов/тарифов.
 * Собирает ВСЕ ошибки по всем строкам разом (не останавливается на первой) —
 * так пользователь сразу видит всё, что нужно поправить.
 */
export function validateRows(rows: ParsedDeliveryRow[], addresses: Address[], rates: AddressRate[]): ValidationResult {
  // Сверяем по коду "82/N", а не по полному тексту — часть строк в исходнике
  // содержит вольную формулировку адреса с тем же кодом (см. комментарий у
  // extractAddressCode в importParser.ts).
  const addressByCode = new Map(addresses.filter((a) => a.code).map((a) => [a.code as string, a]));
  const ratesByAddress = new Map<number, AddressRate[]>();
  for (const rate of rates) {
    const list = ratesByAddress.get(rate.addressId) ?? [];
    list.push(rate);
    ratesByAddress.set(rate.addressId, list);
  }
  for (const list of ratesByAddress.values()) {
    list.sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
  }

  const errors: ImportRowError[] = [];
  const validated: ValidatedRow[] = [];

  for (const row of rows) {
    const dateLabel = row.date.toISOString().slice(0, 10);
    const addressText = row.addressText.trim();
    const code = extractAddressCode(addressText);
    const address = code ? addressByCode.get(code) : undefined;
    if (!address) {
      errors.push({
        rowNumber: row.rowNumber,
        date: dateLabel,
        addressText,
        message: code
          ? `Адрес с кодом "${code}" не найден в справочнике (строка: "${addressText}")`
          : `Не удалось определить код адреса в строке: "${addressText}"`,
      });
      continue;
    }

    const candidateRates = ratesByAddress.get(address.id) ?? [];
    const rate = candidateRates.find((r) => r.effectiveFrom.getTime() <= row.date.getTime());
    if (!rate) {
      errors.push({
        rowNumber: row.rowNumber,
        date: dateLabel,
        addressText,
        message: `Тариф не задан для адреса "${addressText}" на дату ${dateLabel} — заполните справочник тарифов`,
      });
      continue;
    }

    // Полная точность, без округления построчно — округление до копеек
    // применяется только один раз, к готовому ИТОГО (день/тариф/месяц), иначе
    // при пересуммировании накапливается расхождение в копейку (сверено на
    // реальных документах — см. Context плана).
    const expectedCost = row.massKg * rate.pricePerKg;
    if (Math.abs(expectedCost - row.fileCost) > COST_TOLERANCE) {
      errors.push({
        rowNumber: row.rowNumber,
        date: dateLabel,
        addressText,
        message:
          `Сумма не соответствует тарифу в строке ${row.rowNumber} (${dateLabel}, ${addressText}): ` +
          `${row.massKg} кг × ${rate.pricePerKg} ₽/кг = ${expectedCost.toFixed(2)} ₽, а в файле указано ${row.fileCost} ₽. ` +
          `Проверьте вводные данные.`,
      });
      continue;
    }

    validated.push({ ...row, addressId: address.id, ratePerKg: rate.pricePerKg, expectedCost });
  }

  return { valid: errors.length === 0, errors, validated };
}
