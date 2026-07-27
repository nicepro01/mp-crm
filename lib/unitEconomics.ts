import { Prisma } from "@prisma/client";

type MarginInput = {
  cogsRub: Prisma.Decimal.Value;
  inboundLogisticsRub: Prisma.Decimal.Value;
  mpCommissionRub: Prisma.Decimal.Value;
  mpLogisticsRub: Prisma.Decimal.Value;
  storageRub: Prisma.Decimal.Value;
  adsRub: Prisma.Decimal.Value;
  taxRub: Prisma.Decimal.Value;
  laborAllocRub: Prisma.Decimal.Value;
  sellPriceRub: Prisma.Decimal.Value;
};

/** Чистая маржа = цена продажи минус все статьи расходов на юнит. */
export function computeMargin(input: MarginInput) {
  const totalCosts = [
    input.cogsRub,
    input.inboundLogisticsRub,
    input.mpCommissionRub,
    input.mpLogisticsRub,
    input.storageRub,
    input.adsRub,
    input.taxRub,
    input.laborAllocRub,
  ].reduce(
    (sum: Prisma.Decimal, v) => sum.plus(new Prisma.Decimal(v)),
    new Prisma.Decimal(0)
  );

  const sellPrice = new Prisma.Decimal(input.sellPriceRub);
  const netMarginRub = sellPrice.minus(totalCosts);
  const netMarginPct = sellPrice.greaterThan(0)
    ? netMarginRub.dividedBy(sellPrice).times(100)
    : new Prisma.Decimal(0);

  return {
    netMarginRub: netMarginRub.toDecimalPlaces(2),
    netMarginPct: netMarginPct.toDecimalPlaces(2),
  };
}
