-- CreateEnum
CREATE TYPE "ListingLifecycleStatus" AS ENUM ('SELLING', 'NEW_TESTING', 'PHASING_OUT');

-- AlterTable
ALTER TABLE "mp_listings" ADD COLUMN "fulfillmentSchema" TEXT;
ALTER TABLE "mp_listings" ADD COLUMN "lifecycleStatus" "ListingLifecycleStatus";
