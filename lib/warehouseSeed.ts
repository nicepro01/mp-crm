import { prisma } from "./prisma";
import { getCurrentCompanyId } from "./tenantContext";

const OWN_WAREHOUSE_NAME = "Свой склад (B2B)";

/**
 * Идемпотентный сидинг складов: свой склад под B2B (один на всю систему)
 * и пара FBO/FBS для каждой существующей площадки. Вызывается лениво —
 * при заходе на страницы складов/остатков и сразу после создания площадки —
 * поэтому работает и для площадок, добавленных до появления этой логики.
 */
export async function ensureWarehousesSeeded() {
  const ownExists = await prisma.warehouse.findFirst({
    where: { type: "OWN_B2B" },
  });
  if (!ownExists) {
    await prisma.warehouse.create({
      data: { companyId: getCurrentCompanyId(), name: OWN_WAREHOUSE_NAME, type: "OWN_B2B" },
    });
  }

  const marketplaces = await prisma.marketplace.findMany();
  for (const mp of marketplaces) {
    await ensureMarketplaceWarehouses(mp.id, mp.name);
  }
}

export async function ensureMarketplaceWarehouses(
  marketplaceId: string,
  marketplaceName: string
) {
  const fboExists = await prisma.warehouse.findFirst({
    where: { marketplaceId, type: "MARKETPLACE_FBO" },
  });
  if (!fboExists) {
    await prisma.warehouse.create({
      data: {
        companyId: getCurrentCompanyId(),
        name: `${marketplaceName} FBO`,
        type: "MARKETPLACE_FBO",
        marketplaceId,
      },
    });
  }

  const fbsExists = await prisma.warehouse.findFirst({
    where: { marketplaceId, type: "MARKETPLACE_FBS" },
  });
  if (!fbsExists) {
    await prisma.warehouse.create({
      data: {
        companyId: getCurrentCompanyId(),
        name: `${marketplaceName} FBS`,
        type: "MARKETPLACE_FBS",
        marketplaceId,
      },
    });
  }
}
