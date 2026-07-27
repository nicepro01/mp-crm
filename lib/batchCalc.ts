import { Prisma } from "@prisma/client";

type ProductBoxInfo = {
  unitsPerBox: number;
  boxWeightKg: Prisma.Decimal | string | number;
  boxLengthMm: number;
  boxWidthMm: number;
  boxHeightMm: number;
};

export type BatchItemCalc = {
  boxesNeeded: number;
  totalWeightKg: Prisma.Decimal;
  totalVolumeM3: Prisma.Decimal;
};

/** Сколько коробок нужно на позицию, и сколько это весит/занимает — на основе упаковки товара. */
export function calcBatchItem(qty: number, product: ProductBoxInfo): BatchItemCalc {
  const boxesNeeded = Math.ceil(qty / product.unitsPerBox);

  const boxWeightKg = new Prisma.Decimal(product.boxWeightKg);
  const boxVolumeM3 = new Prisma.Decimal(product.boxLengthMm)
    .times(product.boxWidthMm)
    .times(product.boxHeightMm)
    .dividedBy(1_000_000_000); // мм³ -> м³

  return {
    boxesNeeded,
    totalWeightKg: boxWeightKg.times(boxesNeeded),
    totalVolumeM3: boxVolumeM3.times(boxesNeeded),
  };
}

export type BatchSummary = {
  totalBoxes: number;
  totalWeightKg: Prisma.Decimal;
  totalVolumeM3: Prisma.Decimal;
  totalAmountRub: Prisma.Decimal;
};

/** Сводка по всей поставке — сумма расчётов по каждой позиции. */
export function calcBatchSummary(
  items: Array<{ qty: number; purchasePriceRub: Prisma.Decimal | string | number; product: ProductBoxInfo }>
): BatchSummary {
  let totalBoxes = 0;
  let totalWeightKg = new Prisma.Decimal(0);
  let totalVolumeM3 = new Prisma.Decimal(0);
  let totalAmountRub = new Prisma.Decimal(0);

  for (const item of items) {
    const calc = calcBatchItem(item.qty, item.product);
    totalBoxes += calc.boxesNeeded;
    totalWeightKg = totalWeightKg.plus(calc.totalWeightKg);
    totalVolumeM3 = totalVolumeM3.plus(calc.totalVolumeM3);
    totalAmountRub = totalAmountRub.plus(
      new Prisma.Decimal(item.purchasePriceRub).times(item.qty)
    );
  }

  return { totalBoxes, totalWeightKg, totalVolumeM3, totalAmountRub };
}
