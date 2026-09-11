import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

const prisma = new PrismaClient();

async function seedAdmin() {
  // Ищем ЛЮБОГО администратора, а не только с текущим ADMIN_EMAIL — иначе
  // смена ADMIN_EMAIL в .env и перезапуск создаст второго админа вместо
  // переименования первого (которое так и так не задача сидирования).
  const existing = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (existing) {
    console.log(`Администратор уже существует (${existing.email}), пропускаю сидирование`);
    return;
  }

  const passwordHash = await bcrypt.hash(env.adminPassword, 10);
  await prisma.user.create({
    data: {
      email: env.adminEmail,
      passwordHash,
      role: "ADMIN",
    },
  });
  console.log(`Создан администратор ${env.adminEmail}`);
}

// Справочник адресов доставки (вкладка "адреса столовых" в присылаемом
// заказчиком файле-расшифровке) — без тарифов, их пользователь вносит сам
// через UI (см. AddressRate). city — как в исходнике, только для
// сортировки/группировки в справочнике.
const ADDRESSES: Array<{ code: string; fullAddress: string; city: string }> = [
  { code: "82/1", fullAddress: "82/1 г.Севастополь,ул. Казачья,25", city: "Севастополь Юг" },
  { code: "82/2", fullAddress: "82/2.Севастополь,ул.Крепостное шоссе,1", city: "Севастополь Юг" },
  { code: "82/3", fullAddress: "82/3.Севастополь, тер. Причал 84, ул.Лукомская", city: "Севастополь Юг" },
  { code: "82/4", fullAddress: "82/4 г.Севастополь, Монастырское шоссе 121-А", city: "Севастополь Юг" },
  { code: "82/5", fullAddress: "82/5 г.Севастополь,ул.Челюскинцев,47", city: "Севастополь Север" },
  { code: "82/7-1", fullAddress: "82/7-1 г.Севастополь, ул. Мореходная,1", city: "Севастополь Юг" },
  { code: "82/8", fullAddress: "82/8 г.Севастополь, ул. Парковая,1", city: "Севастополь Юг" },
  { code: "82/9", fullAddress: "82/9 г.Севастополь, ул. Корчагина 15 \"А\"", city: "Севастополь Юг" },
  { code: "82/10", fullAddress: "82/10. Севастополь, Рыбацкий причал, 22", city: "Севастополь Юг" },
  { code: "82/11", fullAddress: "82/11. Севастополь, тер. Причал 72", city: "Севастополь Юг" },
  { code: "82/12", fullAddress: "82/12 г.Джанкой ул.Московская д.283", city: "Джанкой" },
  { code: "82/13", fullAddress: "82/13 г. Севастополь, п. Сахарная головка", city: "Севастополь Север" },
  { code: "82/15", fullAddress: "82/15 г.Севастополь, Госпитальный спуск, д.1", city: "Севастополь Юг" },
  { code: "82/16", fullAddress: "82/16  Севастополь , ул.Героев Севастополя , 17", city: "Севастополь Юг" },
  { code: "82/19", fullAddress: "82/19 Крым.,Черноморский р-н, с. Оленевка, мыс Тарханкут", city: "Север Крыма" },
  { code: "82/20", fullAddress: "82/20 Симферопольский р-н, пгт Гвардейское 1, ул. Острякова 27/4", city: "пгт Гвардейское Симферополь" },
  { code: "82/21", fullAddress: "82/21 п. Кача, ул. Авиаторов 15А (Летная, Матросская, Склад)", city: "Кача" },
  { code: "82/22", fullAddress: "82/22 г.  Феодосия, ул. Горького 11", city: "Феодосия" },
  { code: "82/23", fullAddress: "82/23 г.Судак, ул. Набережная 59", city: "Судак" },
  { code: "82/25-1", fullAddress: "82/25-1 г. Севастополь, ул. Дыбенко 1а", city: "Севастополь Юг" },
  { code: "82/25-2", fullAddress: "82/25-2 г. Севастополь, ул. Парковая, 6", city: "Севастополь Юг" },
  { code: "82/26", fullAddress: "82/26 Симферопольский р-н, с. Перевальное, ул. Октябрьская, 51", city: "Симферополь" },
  { code: "82/27", fullAddress: "82/27 г. Севастополь, бухта Омега (на 150 коек)", city: "Севастополь Юг" },
  { code: "82/28", fullAddress: "82/28 г. Феодосия, Федько 38", city: "Феодосия" },
  { code: "82/30", fullAddress: "82/30 Керчь, ул. Международная, 64", city: "Керчь" },
  { code: "82/31", fullAddress: "82/31 Сакский район, пгт Новофедоровка, ул. Сердюкова,10", city: "Саки" },
  { code: "82/32", fullAddress: "82/32 Евпатория, 5-й авиагородок 30", city: "Евпатория" },
  { code: "82/33", fullAddress: "82/33  г. Севастополь, ул. Шабалина 16", city: "Севастополь Юг" },
  { code: "82/34", fullAddress: "82/34 г. Севастополь, ул. Горпищенко 110", city: "Севастополь Юг" },
  { code: "82/37", fullAddress: "82/37 Бахчисарай, ул. Симферопольская 42", city: "Бахчисарай" },
  { code: "82/38", fullAddress: "82/38 Сакский р-н, п. Витино", city: "Саки" },
  { code: "82/39", fullAddress: "82/39 г. Симферополь, ул. Горького 18 (на 300 коек)", city: "Симферополь" },
  { code: "82/40", fullAddress: "82/40 г. Севастополь, ул. Федоровская, 1", city: "Севастополь Север" },
  { code: "82/41", fullAddress: "82/41 г. Симферополь, ул. Калинина 4", city: "Симферополь" },
  { code: "82/42", fullAddress: "82/42 г. Севастополь, Монастырское шоссе 7", city: "Севастополь Юг" },
  { code: "82/43", fullAddress: "82/43 г. Севастополь, ул. Эпроновская 7 (Гос.океанариум)", city: "Севастополь Юг" },
  { code: "82/44", fullAddress: "82/44 Феодосийский район, п. Кировское", city: "Феодосия" },
  { code: "82/45", fullAddress: "82/45 г. Севастополь, с. Резервное", city: "Ялта" },
  { code: "82/47", fullAddress: "82/47 г. Феодосия, ул. Насыпная, д. 3", city: "Феодосия" },
  { code: "82/48", fullAddress: "82/48 г. Феодосия, с. Краснокаменка, ул. Ленина, д. 40А", city: "Феодосия" },
];

async function seedAddresses() {
  const count = await prisma.address.count();
  if (count > 0) {
    console.log(`Справочник адресов уже заполнен (${count}), пропускаю сидирование`);
    return;
  }
  await prisma.address.createMany({ data: ADDRESSES });
  console.log(`Загружено адресов: ${ADDRESSES.length}`);
}

// Реквизиты сторон для актов/счёта — реальные, из уже согласованных
// документов; пользователь при необходимости правит их через UI.
async function seedOrgProfiles() {
  const count = await prisma.orgProfile.count();
  if (count > 0) {
    console.log(`Реквизиты сторон уже заполнены (${count}), пропускаю сидирование`);
    return;
  }
  await prisma.orgProfile.createMany({
    data: [
      {
        role: "SUPPLIER",
        name: "ИП Царюк Алексей Борисович",
        inn: "920451405776",
        legalAddress: "299040, Севастополь г, Хрусталева ул, дом № 93, квартира 2",
        phone: "+7(978)7590213",
        bankName: "Банк ВТБ (ПАО), Филиал \"Центральный\"",
        bankAccount: "40802810300810046245",
        bik: "044525411",
        corrAccount: "30101810145250000411",
        dispatchPoint: "г. Севастополь Камышовое шоссе д.15",
        contractNumber: "ВПЛРБЕФЮ-1ЦАБ",
        contractDate: new Date("2026-04-01"),
        contractIgk: "1770425226125Z000051",
      },
      {
        role: "BUYER",
        name: "ООО «РБЕ»",
        inn: "7717798160",
        kpp: "910243001",
        legalAddress:
          "115280, Г.МОСКВА, ВН.ТЕР.Г. МУНИЦИПАЛЬНЫЙ ОКРУГ ДАНИЛОВСКИЙ, ПРОЕЗД 1-Й АВТОЗАВОДСКИЙ, Д. 4, К. 1, ПОМЕЩ. II",
      },
    ],
  });
  console.log("Загружены реквизиты Поставщика и Покупателя");
}

// Реальные тарифы за кг, выведенные из трёх боевых файлов-расшифровок за
// уже закрытый июль 2026 (K/J по каждой строке = тариф; проверено построчно
// на всех трёх периодах). Часть адресов подорожала с 21.07.2026 (см.
// [[fleet-portal-vps-migration]]-обсуждение в чате) — базовый тариф считаем
// действующим "всегда" (с начала года), выше — с даты реального изменения.
// Для остальных адресов справочника (не встречались в июльских файлах)
// тариф пользователь внесёт сам через UI.
const BASE_RATE_DATE = new Date("2026-01-01T00:00:00.000Z");
const JULY_CHANGE_DATE = new Date("2026-07-21T00:00:00.000Z");
// Сверка с присланным пользователем актуальным файлом "Цены.xlsx"
// (2026-09-11): 5 расхождений с тем, что было в справочнике — новый тариф
// вносим отдельной строкой с 1.08.2026 (для 4 адресов, которых не было ни в
// одном из июльских файлов, тариф до этой даты просто не был известен; для
// 82/39 — реальное снижение обратно с 9.76 до 4.95).
const AUGUST_CHANGE_DATE = new Date("2026-08-01T00:00:00.000Z");

const RATES_4_95 = [
  "82/1", "82/10", "82/11", "82/13", "82/15", "82/16", "82/2", "82/21", "82/25-1",
  "82/25-2", "82/27", "82/3", "82/33", "82/34", "82/37", "82/4", "82/40", "82/41",
  "82/42", "82/43", "82/5", "82/7-1", "82/9",
];
const RATES_6_1 = ["82/26", "82/31"];
// 6.1 -> 9.76 с 21.07.2026
const RATES_6_1_TO_9_76 = ["82/12", "82/20", "82/22", "82/28", "82/30", "82/32", "82/38", "82/44", "82/47", "82/48"];
// 4.95 -> 9.76 с 21.07.2026 (единственный такой адрес в данных)
const RATES_4_95_TO_9_76 = ["82/39"];
// Не встречались ни в одном из июльских файлов — тариф известен только из
// "Цены.xlsx", с 1.08.2026.
const RATES_FROM_AUGUST_4_95 = ["82/8", "82/19", "82/23", "82/45"];
// 82/39: 9.76 (с 21.07) -> 4.95 (с 1.08) — реальное снижение по "Цены.xlsx".
const RATE_82_39_AUGUST = 4.95;

async function seedAddressRates() {
  const count = await prisma.addressRate.count();
  if (count > 0) {
    console.log(`Тарифы уже заполнены (${count}), пропускаю сидирование`);
    return;
  }

  async function addBaseRate(code: string, pricePerKg: number) {
    const address = await prisma.address.findUnique({ where: { fullAddress: ADDRESSES.find((a) => a.code === code)!.fullAddress } });
    if (!address) return;
    await prisma.addressRate.create({ data: { addressId: address.id, pricePerKg, effectiveFrom: BASE_RATE_DATE } });
  }
  async function addChangedRate(code: string, baseRate: number) {
    await addBaseRate(code, baseRate);
    const address = await prisma.address.findUnique({ where: { fullAddress: ADDRESSES.find((a) => a.code === code)!.fullAddress } });
    if (!address) return;
    await prisma.addressRate.create({ data: { addressId: address.id, pricePerKg: 9.76, effectiveFrom: JULY_CHANGE_DATE } });
  }

  async function addRate(code: string, pricePerKg: number, effectiveFrom: Date) {
    const address = await prisma.address.findUnique({ where: { fullAddress: ADDRESSES.find((a) => a.code === code)!.fullAddress } });
    if (!address) return;
    await prisma.addressRate.create({ data: { addressId: address.id, pricePerKg, effectiveFrom } });
  }

  for (const code of RATES_4_95) await addBaseRate(code, 4.95);
  for (const code of RATES_6_1) await addBaseRate(code, 6.1);
  for (const code of RATES_6_1_TO_9_76) await addChangedRate(code, 6.1);
  for (const code of RATES_4_95_TO_9_76) await addChangedRate(code, 4.95);
  for (const code of RATES_FROM_AUGUST_4_95) await addRate(code, 4.95, AUGUST_CHANGE_DATE);
  await addRate("82/39", RATE_82_39_AUGUST, AUGUST_CHANGE_DATE);

  console.log("Загружены тарифы, выведенные из июльских данных");
}

async function main() {
  await seedAdmin();
  await seedAddresses();
  await seedOrgProfiles();
  await seedAddressRates();
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
