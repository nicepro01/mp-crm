-- CreateEnum
CREATE TYPE "FunnelGranularity" AS ENUM ('DAY', 'MONTH');

-- CreateTable
CREATE TABLE "marketplace_daily_funnel" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "marketplaceId" TEXT NOT NULL,
    "granularity" "FunnelGranularity" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "orderedQty" INTEGER NOT NULL,
    "boughtOutQty" INTEGER NOT NULL,
    "cancelledQty" INTEGER NOT NULL,
    "isProvisional" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_daily_funnel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketplace_daily_funnel_companyId_idx" ON "marketplace_daily_funnel"("companyId");

-- CreateIndex
CREATE INDEX "marketplace_daily_funnel_marketplaceId_periodStart_idx" ON "marketplace_daily_funnel"("marketplaceId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_daily_funnel_marketplaceId_granularity_periodSt_key" ON "marketplace_daily_funnel"("marketplaceId", "granularity", "periodStart");

-- AddForeignKey
ALTER TABLE "marketplace_daily_funnel" ADD CONSTRAINT "marketplace_daily_funnel_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_daily_funnel" ADD CONSTRAINT "marketplace_daily_funnel_marketplaceId_fkey" FOREIGN KEY ("marketplaceId") REFERENCES "marketplaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
