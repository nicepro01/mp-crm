// Сезонность считаем на лету из накопленных помесячных продаж (см.
// ProductMonthlySales) — ничего не кешируем в отдельном поле, чтобы не
// разойтись с исходными данными при повторных синках.

export type MonthlySalesRow = { month: number; qtySold: number; daysInPeriod: number };

// Меньше этого суммарного числа дней истории по товару — считаем, что
// данных недостаточно для сезонной поправки, и вызывающий код должен
// откатиться на ручной seasonalDemandMultiplier.
const MIN_TOTAL_DAYS_FOR_INDEX = 60;

/**
 * Индекс сезонности по календарным месяцам (1-12): во сколько раз
 * среднесуточные продажи в этом месяце отличаются от среднего по всем
 * месяцам, за которые есть данные. 1 = нет отклонения. Месяцы без данных
 * в карте отсутствуют — вызывающий код должен подставлять 1 по умолчанию.
 */
export function computeSeasonalIndex(rows: MonthlySalesRow[]): Map<number, number> {
  const totalDays = rows.reduce((sum, r) => sum + r.daysInPeriod, 0);
  const totalQty = rows.reduce((sum, r) => sum + r.qtySold, 0);
  if (totalDays < MIN_TOTAL_DAYS_FOR_INDEX || totalQty === 0) return new Map();

  const overallAvgDaily = totalQty / totalDays;
  if (overallAvgDaily === 0) return new Map();

  const byMonth = new Map<number, { qty: number; days: number }>();
  for (const r of rows) {
    const acc = byMonth.get(r.month) ?? { qty: 0, days: 0 };
    acc.qty += r.qtySold;
    acc.days += r.daysInPeriod;
    byMonth.set(r.month, acc);
  }

  const index = new Map<number, number>();
  for (const [month, acc] of byMonth) {
    if (acc.days === 0) continue;
    index.set(month, acc.qty / acc.days / overallAvgDaily);
  }
  return index;
}

/**
 * Средний сезонный коэффициент на горизонт планирования вперёд от
 * startDate — взвешенный по тому, сколько дней каждого календарного месяца
 * попадает в окно [startDate, startDate + horizonDays). Месяцы без данных
 * в индексе учитываются как 1 (без поправки).
 */
export function seasonalWeightForWindow(
  indexByMonth: Map<number, number>,
  startDate: Date,
  horizonDays: number
): number {
  if (indexByMonth.size === 0 || horizonDays <= 0) return 1;

  let sum = 0;
  const cursor = new Date(startDate);
  for (let i = 0; i < horizonDays; i++) {
    const month = cursor.getMonth() + 1;
    sum += indexByMonth.get(month) ?? 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return sum / horizonDays;
}
