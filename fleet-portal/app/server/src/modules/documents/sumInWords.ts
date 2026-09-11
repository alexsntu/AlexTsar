// Сумма прописью для актов/счёта — сверено на реальных примерах:
// 208385.48 -> "Двести восемь тысяч триста восемьдесят пять руб. 48 коп."
// 5554372.39 -> "Пять миллионов пятьсот пятьдесят четыре тысячи триста
// семьдесят два руб. 39 коп." В реальных документах "руб." — фиксированное
// сокращение (без согласования рубль/рубля/рублей), а не только у "тысяча"/
// "миллион" нужна форма по числу.

const ONES_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const ONES_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
const TEENS = [
  "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать",
  "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать",
];
const TENS = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
const HUNDREDS = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];

type PluralForms = [singular: string, few: string, many: string];

function pluralForm(n: number, forms: PluralForms): string {
  const n100 = n % 100;
  const n10 = n % 10;
  if (n100 >= 11 && n100 <= 14) return forms[2];
  if (n10 === 1) return forms[0];
  if (n10 >= 2 && n10 <= 4) return forms[1];
  return forms[2];
}

function threeDigitsToWords(n: number, feminine: boolean): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) words.push(HUNDREDS[hundreds]);
  if (rest >= 10 && rest < 20) {
    words.push(TEENS[rest - 10]);
  } else {
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens) words.push(TENS[tens]);
    if (ones) words.push((feminine ? ONES_F : ONES_M)[ones]);
  }
  return words;
}

const SCALES: Array<{ forms: PluralForms; feminine: boolean } | null> = [
  null, // единицы — без слова-разряда
  { forms: ["тысяча", "тысячи", "тысяч"], feminine: true },
  { forms: ["миллион", "миллиона", "миллионов"], feminine: false },
  { forms: ["миллиард", "миллиарда", "миллиардов"], feminine: false },
];

function integerToWords(n: number): string {
  if (n === 0) return "ноль";
  const groups: number[] = [];
  let rem = n;
  while (rem > 0) {
    groups.push(rem % 1000);
    rem = Math.floor(rem / 1000);
  }

  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    const g = groups[i];
    if (g === 0) continue;
    const scale = SCALES[i];
    parts.push(...threeDigitsToWords(g, scale?.feminine ?? false));
    if (scale) parts.push(pluralForm(g, scale.forms));
  }
  return parts.join(" ");
}

/** round2-нное значение в рублях -> "Пять миллионов ... руб. NN коп." */
export function rublesInWords(amount: number): string {
  const rub = Math.floor(amount + 1e-9);
  const kop = Math.round((amount - rub) * 100);
  const words = integerToWords(rub);
  const capitalized = words.charAt(0).toUpperCase() + words.slice(1);
  return `${capitalized} руб. ${String(kop).padStart(2, "0")} коп.`;
}
